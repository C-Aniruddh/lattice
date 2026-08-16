import { describe, expect, it } from 'vitest';

import { createScope, type Disposer, type Scope } from '../src/dispose.js';

/**
 * A stand-in for the thing every package in the kit binds: a registry that grows when you
 * subscribe and only shrinks if somebody remembers to unsubscribe. The leak these tests are
 * really about is a `size` that never comes back down.
 */
function makeBus(): { readonly live: Set<() => void>; subscribe: (scope: Scope, fn: () => void) => Disposer } {
  const live = new Set<() => void>();
  return {
    live,
    subscribe(scope, fn) {
      live.add(fn);
      return scope.add(() => {
        live.delete(fn);
      });
    },
  };
}

describe('createScope', () => {
  it('starts empty and undisposed', () => {
    const scope = createScope();
    expect(scope.size).toBe(0);
    expect(scope.disposed).toBe(false);
  });

  it('returns the disposer from add unchanged, so a caller can also hold it', () => {
    const scope = createScope();
    const disposer = (): void => {};
    expect(scope.add(disposer)).toBe(disposer);
    expect(scope.size).toBe(1);
  });

  it('rejects a non-function with a TypeError that names what it got', () => {
    const scope = createScope();
    const bad = undefined as unknown as Disposer;
    expect(() => scope.add(bad)).toThrow(TypeError);
    expect(() => scope.add(bad)).toThrow(/^scope\.add: expected a disposer function, got undefined/);
  });
});

describe('Scope.dispose ordering', () => {
  it('runs disposers in reverse registration order', () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => order.push('a'));
    scope.add(() => order.push('b'));
    scope.add(() => order.push('c'));

    scope.dispose();

    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('has one ordering rule: a child registered third disposes third from last', () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => order.push('first'));
    scope.add(() => order.push('second'));
    const child = scope.child();
    child.add(() => order.push('child-a'));
    child.add(() => order.push('child-b'));
    scope.add(() => order.push('fourth'));

    scope.dispose();

    // 'fourth' was registered last so it goes first; the child is next, and inside it the
    // same single rule applies again; then the two disposers registered before the child.
    expect(order).toEqual(['fourth', 'child-b', 'child-a', 'second', 'first']);
  });

  it('disposes grandchildren before their parents', () => {
    const order: string[] = [];
    const scope = createScope();
    const child = scope.child();
    const grandchild = child.child();
    grandchild.add(() => order.push('grandchild'));
    child.add(() => order.push('child'));
    scope.add(() => order.push('root'));

    scope.dispose();

    expect(order).toEqual(['root', 'child', 'grandchild']);
    expect(child.disposed).toBe(true);
    expect(grandchild.disposed).toBe(true);
  });

  it('empties as it goes, so size is honest during teardown', () => {
    const seen: number[] = [];
    const scope = createScope();
    scope.add(() => seen.push(scope.size));
    scope.add(() => seen.push(scope.size));
    scope.add(() => seen.push(scope.size));

    scope.dispose();

    expect(seen).toEqual([2, 1, 0]);
    expect(scope.size).toBe(0);
  });
});

describe('Scope.dispose idempotence', () => {
  it('runs each disposer exactly once even when disposed twice', () => {
    let runs = 0;
    const scope = createScope();
    scope.add(() => {
      runs += 1;
    });

    scope.dispose();
    scope.dispose();
    scope.dispose();

    expect(runs).toBe(1);
    expect(scope.disposed).toBe(true);
  });

  it('survives a scene torn down by both its owner and its parent', () => {
    let runs = 0;
    const parent = createScope();
    const scene = parent.child();
    scene.add(() => {
      runs += 1;
    });

    scene.dispose(); // the screen closes itself
    parent.dispose(); // and the game tears the whole tree down after

    expect(runs).toBe(1);
  });

  it('ignores a re-entrant dispose from inside a disposer', () => {
    let runs = 0;
    const scope = createScope();
    scope.add(() => {
      runs += 1;
      scope.dispose();
    });
    scope.add(() => {
      runs += 1;
    });

    scope.dispose();

    expect(runs).toBe(2);
  });
});

describe('Scope.add after disposal', () => {
  it('runs the disposer immediately and does not retain it', () => {
    let ran = false;
    const scope = createScope();
    scope.dispose();

    const disposer = scope.add(() => {
      ran = true;
    });

    expect(ran).toBe(true);
    expect(scope.size).toBe(0);
    expect(disposer).toBeTypeOf('function');
  });

  it('cleans up a subscription created during teardown', () => {
    const bus = makeBus();
    const scope = createScope();

    // A disposer that emits; the listener it wakes subscribes again, mid-teardown.
    scope.add(() => {
      bus.subscribe(scope, () => {});
    });
    bus.subscribe(scope, () => {});

    scope.dispose();

    expect(bus.live.size).toBe(0);
  });

  it('hands back an already-disposed child from a disposed scope', () => {
    const scope = createScope();
    scope.dispose();

    const child = scope.child();
    let ran = false;
    child.add(() => {
      ran = true;
    });

    expect(child.disposed).toBe(true);
    expect(ran).toBe(true);
    expect(child.size).toBe(0);
  });
});

describe('Scope.dispose error handling', () => {
  it('runs every disposer even when one throws, then reports as an AggregateError', () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => order.push('a'));
    scope.add(() => order.push('b'));
    scope.add(() => {
      order.push('boom');
      throw new Error('teardown failed');
    });
    scope.add(() => order.push('d'));
    scope.add(() => order.push('e'));

    let caught: unknown;
    try {
      scope.dispose();
    } catch (error) {
      caught = error;
    }

    expect(order).toEqual(['e', 'd', 'boom', 'b', 'a']);
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(1);
    expect((aggregate.errors[0] as Error).message).toBe('teardown failed');
    expect(aggregate.message).toBe(
      'scope.dispose: 1 of 5 disposers threw; all of them still ran — the causes are in `.errors`',
    );
    expect(scope.disposed).toBe(true);
    expect(scope.size).toBe(0);
  });

  it('collects every failure, not just the first', () => {
    const scope = createScope();
    scope.add(() => {
      throw new RangeError('one');
    });
    scope.add(() => {
      throw new RangeError('two');
    });

    let caught: unknown;
    try {
      scope.dispose();
    } catch (error) {
      caught = error;
    }

    const aggregate = caught as AggregateError;
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.message).toContain('2 of 2 disposers threw');
  });

  it('does not strand a parent when a child throws', () => {
    const order: string[] = [];
    const scope = createScope();
    scope.add(() => order.push('parent-resource'));
    const child = scope.child();
    child.add(() => {
      throw new Error('child failed');
    });

    expect(() => scope.dispose()).toThrow(AggregateError);
    expect(order).toEqual(['parent-resource']);
  });
});

describe('the leak this module exists to prevent', () => {
  it('leaves nothing live after a hundred open/close cycles', () => {
    const bus = makeBus();
    const app = createScope();

    for (let i = 0; i < 100; i += 1) {
      const screen = app.child();
      bus.subscribe(screen, () => {});
      bus.subscribe(screen, () => {});
      const panel = screen.child();
      bus.subscribe(panel, () => {});
      expect(bus.live.size).toBe(3);
      screen.dispose();
      expect(bus.live.size).toBe(0);
    }

    // The child scopes' own disposers, however, are still registered on the app scope: a
    // scope that outlives a hundred screens is itself the leak, and this is what it looks
    // like from the outside.
    expect(app.size).toBe(100);
    app.dispose();
    expect(app.size).toBe(0);
    expect(bus.live.size).toBe(0);
  });

  it('lets a caller dispose early without breaking the scope', () => {
    const bus = makeBus();
    const scope = createScope();
    const early = bus.subscribe(scope, () => {});
    bus.subscribe(scope, () => {});

    early();
    early(); // idempotent by contract — a second call must not undo somebody else's work
    expect(bus.live.size).toBe(1);

    scope.dispose();
    expect(bus.live.size).toBe(0);
  });
});
