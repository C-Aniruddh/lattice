import { describe, expect, it } from 'vitest';

import { createScope } from '../src/dispose.js';
import { Emitter } from '../src/events.js';

/** The map is declared as an `interface` on purpose — that is what the docs tell a caller to
 *  do, and a constraint of `Record<string, unknown>` would reject it at the type level. */
interface GameEvents {
  built: { id: string };
  tick: number;
  ready: void;
}

describe('Emitter dispatch', () => {
  it('calls listeners synchronously, in registration order', () => {
    const events = new Emitter<GameEvents>();
    const order: string[] = [];
    events.on('tick', () => order.push('first'));
    events.on('tick', () => order.push('second'));
    events.on('tick', () => order.push('third'));

    events.emit('tick', 1);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('passes the payload through untouched', () => {
    const events = new Emitter<GameEvents>();
    const seen: { id: string }[] = [];
    const payload = { id: 'mine' };
    events.on('built', (p) => seen.push(p));

    events.emit('built', payload);

    expect(seen).toEqual([payload]);
    expect(seen[0]).toBe(payload);
  });

  it('emits a payload-free event', () => {
    const events = new Emitter<GameEvents>();
    let ran = 0;
    events.on('ready', () => {
      ran += 1;
    });

    events.emit('ready', undefined);

    expect(ran).toBe(1);
  });

  it('is a no-op when nothing is listening', () => {
    const events = new Emitter<GameEvents>();
    expect(() => events.emit('tick', 0)).not.toThrow();
    expect(events.listenerCount('tick')).toBe(0);
  });

  it('calls one listener once per emit, and nothing on other events', () => {
    const events = new Emitter<GameEvents>();
    let ticks = 0;
    events.on('tick', () => {
      ticks += 1;
    });

    events.emit('tick', 1);
    events.emit('ready', undefined);
    events.emit('tick', 2);

    expect(ticks).toBe(2);
  });

  it('lets a throwing listener propagate rather than half-updating the world', () => {
    const events = new Emitter<GameEvents>();
    let after = 0;
    events.on('tick', () => {
      throw new Error('listener failed');
    });
    events.on('tick', () => {
      after += 1;
    });

    expect(() => events.emit('tick', 1)).toThrow('listener failed');
    expect(after).toBe(0);
  });
});

describe('Emitter dispatch is over a snapshot', () => {
  it('still calls the third listener when the first unsubscribes the second', () => {
    const events = new Emitter<GameEvents>();
    const order: string[] = [];
    events.on('tick', () => {
      order.push('one');
      offSecond();
    });
    const offSecond = events.on('tick', () => order.push('two'));
    events.on('tick', () => order.push('three'));

    events.emit('tick', 1);

    // The index-shift bug drops 'three' here.
    expect(order).toEqual(['one', 'two', 'three']);
    expect(events.listenerCount('tick')).toBe(2);

    order.length = 0;
    events.emit('tick', 2);
    expect(order).toEqual(['one', 'three']);
  });

  it('does not call a listener subscribed during dispatch until the next emit', () => {
    const events = new Emitter<GameEvents>();
    const order: string[] = [];
    events.on('tick', () => {
      order.push('outer');
      events.on('tick', () => order.push('inner'));
    });

    events.emit('tick', 1);
    expect(order).toEqual(['outer']);

    events.emit('tick', 2);
    expect(order).toEqual(['outer', 'outer', 'inner']);
  });

  it('does not call a listener that clear() removed mid-dispatch, on the next round', () => {
    const events = new Emitter<GameEvents>();
    const order: string[] = [];
    events.on('tick', () => {
      order.push('one');
      events.clear('tick');
    });
    events.on('tick', () => order.push('two'));

    events.emit('tick', 1);
    expect(order).toEqual(['one', 'two']);
    expect(events.listenerCount('tick')).toBe(0);

    events.emit('tick', 2);
    expect(order).toEqual(['one', 'two']);
  });
});

describe('Emitter.once', () => {
  it('fires exactly once and unsubscribes itself', () => {
    const events = new Emitter<GameEvents>();
    const seen: number[] = [];
    events.once('tick', (n) => seen.push(n));

    events.emit('tick', 1);
    events.emit('tick', 2);

    expect(seen).toEqual([1]);
    expect(events.listenerCount('tick')).toBe(0);
  });

  it('unsubscribes before the body runs, so a listener that re-emits terminates', () => {
    const events = new Emitter<GameEvents>();
    let runs = 0;
    events.once('tick', () => {
      runs += 1;
      if (runs < 100) events.emit('tick', runs);
    });

    events.emit('tick', 0);

    expect(runs).toBe(1);
  });

  it('can be cancelled before it ever fires', () => {
    const events = new Emitter<GameEvents>();
    let ran = 0;
    const off = events.once('tick', () => {
      ran += 1;
    });

    off();
    events.emit('tick', 1);

    expect(ran).toBe(0);
    expect(events.listenerCount('tick')).toBe(0);
  });

  it('rejects a non-function listener', () => {
    const events = new Emitter<GameEvents>();
    const bad = undefined as unknown as (payload: number) => void;
    expect(() => events.once('tick', bad)).toThrow(TypeError);
    expect(() => events.once('tick', bad)).toThrow(
      "emitter.once('tick'): expected a listener function, got undefined",
    );
  });
});

describe('the Disposer returned by on', () => {
  it('unsubscribes', () => {
    const events = new Emitter<GameEvents>();
    let ran = 0;
    const off = events.on('tick', () => {
      ran += 1;
    });

    events.emit('tick', 1);
    off();
    events.emit('tick', 2);

    expect(ran).toBe(1);
    expect(events.listenerCount('tick')).toBe(0);
  });

  it('is idempotent: a second call does not remove a later listener that reused the slot', () => {
    const events = new Emitter<GameEvents>();
    const order: string[] = [];
    const listener = (): void => {
      order.push('shared');
    };

    const offFirst = events.on('tick', listener);
    events.on('tick', listener); // the same function, registered a second time

    offFirst();
    offFirst();
    offFirst();

    expect(events.listenerCount('tick')).toBe(1);
    events.emit('tick', 1);
    expect(order).toEqual(['shared']);
  });

  it('works where a bound method never would', () => {
    const events = new Emitter<GameEvents>();
    class Panel {
      count = 0;
      handle(): void {
        this.count += 1;
      }
    }
    const panel = new Panel();

    const off = events.on('tick', panel.handle.bind(panel));
    events.emit('tick', 1);
    // `off(event, this.handle.bind(this))` would create a *new* function and remove nothing.
    events.off('tick', panel.handle.bind(panel));
    expect(events.listenerCount('tick')).toBe(1);

    off();
    events.emit('tick', 2);

    expect(panel.count).toBe(1);
    expect(events.listenerCount('tick')).toBe(0);
  });

  it('hands straight to a Scope', () => {
    const events = new Emitter<GameEvents>();
    const scope = createScope();
    let ran = 0;
    scope.add(
      events.on('tick', () => {
        ran += 1;
      }),
    );

    events.emit('tick', 1);
    scope.dispose();
    events.emit('tick', 2);

    expect(ran).toBe(1);
    expect(events.listenerCount('tick')).toBe(0);
  });
});

describe('Emitter.off', () => {
  it('removes by reference', () => {
    const events = new Emitter<GameEvents>();
    const listener = (): void => {};
    events.on('tick', listener);

    events.off('tick', listener);

    expect(events.listenerCount('tick')).toBe(0);
  });

  it('removes one registration when the same function subscribed twice', () => {
    const events = new Emitter<GameEvents>();
    let ran = 0;
    const listener = (): void => {
      ran += 1;
    };
    events.on('tick', listener);
    events.on('tick', listener);

    events.off('tick', listener);
    events.emit('tick', 1);

    expect(events.listenerCount('tick')).toBe(1);
    expect(ran).toBe(1);
  });

  it('removes the right one out of three', () => {
    const events = new Emitter<GameEvents>();
    const order: string[] = [];
    const middle = (): void => {
      order.push('middle');
    };
    events.on('tick', () => order.push('first'));
    events.on('tick', middle);
    events.on('tick', () => order.push('last'));

    events.off('tick', middle);
    events.emit('tick', 1);

    expect(order).toEqual(['first', 'last']);
  });

  it('is a no-op for an unknown listener or an unknown event', () => {
    const events = new Emitter<GameEvents>();
    const listener = (): void => {};
    events.on('tick', listener);

    events.off('tick', () => {});
    events.off('ready', () => {});

    expect(events.listenerCount('tick')).toBe(1);
    expect(() => events.off('built', () => {})).not.toThrow();
  });

  it('rejects a non-function listener on subscribe', () => {
    const events = new Emitter<GameEvents>();
    const bad = null as unknown as (payload: number) => void;
    expect(() => events.on('tick', bad)).toThrow(TypeError);
    expect(() => events.on('tick', bad)).toThrow(
      "emitter.on('tick'): expected a listener function, got null",
    );
  });
});

describe('Emitter.clear', () => {
  it('drops one event and leaves the others', () => {
    const events = new Emitter<GameEvents>();
    events.on('tick', () => {});
    events.on('ready', () => {});

    events.clear('tick');

    expect(events.listenerCount('tick')).toBe(0);
    expect(events.listenerCount('ready')).toBe(1);
  });

  it('drops everything when called with no argument', () => {
    const events = new Emitter<GameEvents>();
    events.on('tick', () => {});
    events.on('ready', () => {});
    events.on('built', () => {});

    events.clear();

    expect(events.listenerCount('tick')).toBe(0);
    expect(events.listenerCount('ready')).toBe(0);
    expect(events.listenerCount('built')).toBe(0);
  });

  it('leaves the emitter usable', () => {
    const events = new Emitter<GameEvents>();
    events.on('tick', () => {});
    events.clear();

    let ran = 0;
    events.on('tick', () => {
      ran += 1;
    });
    events.emit('tick', 1);

    expect(ran).toBe(1);
  });
});

describe('the leak this emitter is designed against', () => {
  it('is back at zero after a thousand open/close cycles', () => {
    const events = new Emitter<GameEvents>();
    const app = createScope();

    for (let i = 0; i < 1000; i += 1) {
      const screen = app.child();
      screen.add(events.on('tick', () => {}));
      screen.add(events.on('built', () => {}));
      screen.add(events.once('ready', () => {}));
      expect(events.listenerCount('tick')).toBe(1);
      screen.dispose();
    }

    expect(events.listenerCount('tick')).toBe(0);
    expect(events.listenerCount('built')).toBe(0);
    expect(events.listenerCount('ready')).toBe(0);
  });

  it('does not accumulate listeners when once fires every round', () => {
    const events = new Emitter<GameEvents>();
    for (let i = 0; i < 1000; i += 1) {
      events.once('tick', () => {});
      events.emit('tick', i);
    }
    expect(events.listenerCount('tick')).toBe(0);
  });
});
