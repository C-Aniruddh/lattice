import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fmtCompact } from '@latticekit/core';
import type { Loop } from '@latticekit/loop';
import { el } from '../src/el.js';
import { roll } from '../src/roll.js';
import { toasts } from '../src/toast.js';
import {
  auditOverlay,
  createOverlay,
  drive,
  internalsOf,
  type Driven,
  type Overlay,
} from '../src/overlay.js';
import { FakeEvent, fakeClock, installDom, type DomHandle, type FakeElement } from './dom.js';

let dom: DomHandle;
let clock: ReturnType<typeof fakeClock>;

beforeEach(() => {
  dom = installDom();
  clock = fakeClock(1000);
});

afterEach(() => {
  dom.restore();
});

function fake(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}

/**
 * The effective `pointer-events` of a node, which is the platform's inheritance rule written
 * out: the property inherits, so a node with no declaration of its own takes its nearest
 * ancestor's. Stating it here is what lets the pointer contract be tested as data in Node.
 */
function effectivePointerEvents(node: FakeElement): string {
  let at: FakeElement | null = node;
  while (at !== null) {
    const computed = dom.doc.defaultView.getComputedStyle(at);
    const value = computed.getPropertyValue('pointer-events');
    if (value !== '') return value;
    at = at.parentNode;
  }
  return 'auto';
}

/** A loop with `@latticekit/loop`'s real callback signatures: a delta in *seconds* for update and
 *  an interpolation alpha for render. Neither is a wall-clock reading, which is why `drive`
 *  ignores both and reads the overlay's own injected clock. */
function fakeLoop(): Driven & {
  update(dt: number, tick: number): void;
  render(alpha: number, time: number, nowMs: number): void;
  subscriptions(): number;
} {
  const updates = new Set<(dt: number, tick: number) => void>();
  const renders = new Set<(alpha: number, time: number, nowMs: number) => void>();
  return {
    onUpdate(fn) {
      updates.add(fn);
      return () => updates.delete(fn);
    },
    onRender(fn) {
      renders.add(fn);
      return () => renders.delete(fn);
    },
    update(dt, tick) {
      for (const fn of [...updates]) fn(dt, tick);
    },
    render(alpha, time, nowMs) {
      for (const fn of [...renders]) fn(alpha, time, nowMs);
    },
    subscriptions: () => updates.size + renders.size,
  };
}

describe('createOverlay: the options', () => {
  it('demands a clock, because a clock it chose would be the second one in the game', () => {
    expect(() => createOverlay({ now: undefined as unknown as () => number })).toThrow(TypeError);
    expect(() => createOverlay(undefined as unknown as { now: () => number })).toThrow(TypeError);
  });

  it('rejects an unknown driver by name', () => {
    expect(() =>
      createOverlay({ now: clock.now, driver: 'raf' as unknown as 'driven' }),
    ).toThrow(RangeError);
  });

  it('rejects standaloneMs in driven mode — a cadence nobody reads', () => {
    expect(() => createOverlay({ now: clock.now, standaloneMs: 500 })).toThrow(RangeError);
    expect(() => createOverlay({ now: clock.now, standaloneMs: 500 })).toThrow(/standalone/);
  });

  it('rejects a standaloneMs or zIndex that is not a finite number', () => {
    expect(() =>
      createOverlay({ now: clock.now, driver: 'standalone', standaloneMs: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      createOverlay({ now: clock.now, driver: 'standalone', standaloneMs: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      createOverlay({ now: clock.now, driver: 'standalone', standaloneMs: -5 }),
    ).toThrow(RangeError);
    expect(() => createOverlay({ now: clock.now, zIndex: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });

  it('says so rather than building into nothing when the document has no body yet', () => {
    Object.defineProperty(dom.doc, 'body', { value: null, configurable: true });
    expect(() => createOverlay({ now: clock.now })).toThrow(/document is ready/);
  });

  it('builds into a given parent, and into document.body otherwise', () => {
    const host = dom.doc.createElement('div');
    const ui = createOverlay({ now: clock.now, parent: host as unknown as HTMLElement });
    expect(fake(ui.root).parentNode).toBe(host);

    const other = createOverlay({ now: clock.now });
    expect(fake(other.root).parentNode).toBe(dom.doc.body);
  });
});

describe('createOverlay: the root and the layers', () => {
  let ui: Overlay;

  beforeEach(() => {
    ui = createOverlay({ now: clock.now, zIndex: 7 });
  });

  it('writes only structural properties on the root — invariant 11', () => {
    const written = [...fake(ui.root).style.props.keys()].sort();
    expect(written).toEqual(['inset', 'pointer-events', 'position', 'z-index']);
    expect(fake(ui.root).style.getPropertyValue('position')).toBe('fixed');
    expect(fake(ui.root).style.getPropertyValue('inset')).toBe('0');
    expect(fake(ui.root).style.getPropertyValue('z-index')).toBe('7');
    expect(fake(ui.root).className).toBe('lattice-ui');
  });

  it('stacks the four layers bottom to top, in DOM order and by z-index', () => {
    const names = ['floats', 'panels', 'modal', 'toasts'] as const;
    const children = fake(ui.root).children;
    expect(children.length).toBe(4);
    names.forEach((name, i) => {
      const node = children.item(i);
      expect(node?.className).toBe(`lattice-layer lattice-layer-${name}`);
      expect(node?.style.getPropertyValue('z-index')).toBe(String(i + 1));
      expect(node?.style.getPropertyValue('pointer-events')).toBe('none');
      expect(ui.layer(name)).toBe(node as unknown as HTMLElement);
    });
  });

  it('names the mistake for an unknown layer', () => {
    expect(() => ui.layer('hud' as unknown as 'panels')).toThrow(RangeError);
  });
});

describe('the pointer contract', () => {
  it('lets a tap that is not on a named node reach the world — invariant 1', () => {
    const ui = createOverlay({ now: clock.now });
    const spacer = ui.mount(el('div', { class: 'spacer' }));
    expect(effectivePointerEvents(fake(spacer))).toBe('none');
  });

  it('still lets it through with a game stylesheet granting `.lattice-layer > *` auto', () => {
    // The exact rule that swallowed every tap in the source game. The node's own inline
    // declaration outranks an author rule, so the spacer stays transparent.
    const ui = createOverlay({ now: clock.now });
    const spacer = ui.mount(el('div', { class: 'spacer' }));
    fake(spacer).computed.set('pointer-events', 'auto');
    expect(effectivePointerEvents(fake(spacer))).toBe('none');
  });

  it('grants interactivity to exactly the node that asked, and to its children by inheritance', () => {
    const ui = createOverlay({ now: clock.now });
    const button = el('button');
    const panel = ui.mount(el('div', undefined, button), { interactive: true });
    expect(effectivePointerEvents(fake(panel))).toBe('auto');
    expect(effectivePointerEvents(fake(button))).toBe('auto');
  });

  it('mounts into `panels` by default and into the named layer otherwise', () => {
    const ui = createOverlay({ now: clock.now });
    const a = ui.mount(el('div'));
    const b = ui.mount(el('div'), { layer: 'toasts' });
    expect(fake(a).parentNode).toBe(fake(ui.layer('panels')));
    expect(fake(b).parentNode).toBe(fake(ui.layer('toasts')));
  });

  it('returns the node so it composes inside an el() call', () => {
    const ui = createOverlay({ now: clock.now });
    const node = el('div');
    expect(ui.mount(node)).toBe(node);
  });

  it('refuses to mount into a destroyed overlay', () => {
    const ui = createOverlay({ now: clock.now });
    ui.destroy();
    expect(() => ui.mount(el('div'))).toThrow(/destroyed/);
  });
});

describe('the two cadences', () => {
  it('starts no clock at all with the default options — invariant 3', () => {
    const ui = createOverlay({ now: clock.now });
    expect(dom.intervals).toBe(0);
    expect(dom.frames).toBe(0);
    const state = vi.fn();
    ui.every(state);
    dom.fireInterval();
    dom.fireFrame();
    expect(state).not.toHaveBeenCalled();
  });

  it('advances state on tick and pixels on repaint, and never the other way round', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    const pixels = vi.fn();
    ui.every(state);
    ui.paint(pixels);

    ui.tick(2000);
    expect(state).toHaveBeenCalledWith(2000);
    expect(pixels).not.toHaveBeenCalled();

    ui.repaint(2016);
    expect(pixels).toHaveBeenCalledWith(2016);
    expect(state).toHaveBeenCalledTimes(1);
  });

  it('defaults both to the overlay’s own clock', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    ui.every(state);
    clock.set(4321);
    ui.tick();
    expect(state).toHaveBeenCalledWith(4321);
  });

  it('rejects a clock reading that is not finite', () => {
    const ui = createOverlay({ now: clock.now });
    ui.every(() => undefined);
    expect(() => ui.tick(Number.NaN)).toThrow(RangeError);
  });

  it('is bound, so the reference can be passed as a value', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    ui.every(state);
    const detached = ui.tick;
    detached(9);
    expect(state).toHaveBeenCalledWith(9);
  });

  it('releases a subscription on dispose', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    const stop = ui.every(state);
    stop();
    ui.tick(1);
    expect(state).not.toHaveBeenCalled();
  });

  it('goes quiet after destroy instead of throwing sixty times a second', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    ui.every(state);
    ui.destroy();
    expect(() => {
      ui.tick(1);
      ui.repaint(1);
    }).not.toThrow();
    expect(state).not.toHaveBeenCalled();
  });
});

describe("driver: 'standalone'", () => {
  it('starts exactly one interval and one frame loop, and advances itself', () => {
    const ui = createOverlay({ now: clock.now, driver: 'standalone', standaloneMs: 250 });
    const state = vi.fn();
    const pixels = vi.fn();
    ui.every(state);
    ui.paint(pixels);
    expect(dom.intervals).toBe(1);
    expect(dom.frames).toBe(1);

    clock.set(5000);
    dom.fireInterval();
    expect(state).toHaveBeenCalledWith(5000);
    dom.fireFrame();
    expect(pixels).toHaveBeenCalledWith(5000);
  });

  it('throws from tick() rather than quietly running a second clock — invariant 4', () => {
    const ui = createOverlay({ now: clock.now, driver: 'standalone' });
    expect(() => ui.tick(1)).toThrow(/two clocks/);
  });

  it('cancels both handles on destroy — invariant 10', () => {
    const ui = createOverlay({ now: clock.now, driver: 'standalone' });
    expect(dom.liveTimers()).toBe(2);
    ui.destroy();
    expect(dom.liveTimers()).toBe(0);
  });
});

describe('drive', () => {
  it('wires update to tick and render to repaint, and nothing crossed — invariant 4', () => {
    const ui = createOverlay({ now: clock.now });
    const loop = fakeLoop();
    const state = vi.fn();
    const pixels = vi.fn();
    ui.every(state);
    ui.paint(pixels);

    drive(ui, loop);
    clock.set(2500);
    loop.update(1 / 60, 3);
    expect(state).toHaveBeenCalledWith(2500);
    expect(pixels).not.toHaveBeenCalled();

    clock.set(2510);
    loop.render(0.5, 2.51, 2510);
    expect(pixels).toHaveBeenCalledWith(2510);
    expect(state).toHaveBeenCalledTimes(1);
  });

  it('ignores the loop’s own callback arguments, which are a delta and an alpha', () => {
    // `loop.onUpdate` hands a delta in *seconds*. Passing it through would tell the overlay the
    // time is 0.0166 ms, forever, and every duration on screen would be wrong by four orders of
    // magnitude while looking plausible.
    const ui = createOverlay({ now: clock.now });
    const loop = fakeLoop();
    const seen: number[] = [];
    ui.every((now) => seen.push(now));
    drive(ui, loop);
    clock.set(7000);
    loop.update(1 / 60, 0);
    expect(seen).toEqual([7000]);
  });

  it('unwires both on dispose, idempotently', () => {
    const ui = createOverlay({ now: clock.now });
    const loop = fakeLoop();
    const state = vi.fn();
    ui.every(state);
    const stop = drive(ui, loop);
    expect(loop.subscriptions()).toBe(2);
    stop();
    stop();
    expect(loop.subscriptions()).toBe(0);
    loop.update(0, 0);
    expect(state).not.toHaveBeenCalled();
  });

  it('is unwired by ui.destroy(), so a torn-down HUD cannot stay on a live loop — invariant 10', () => {
    const ui = createOverlay({ now: clock.now });
    const loop = fakeLoop();
    drive(ui, loop);
    expect(loop.subscriptions()).toBe(2);
    ui.destroy();
    expect(loop.subscriptions()).toBe(0);
  });

  it('refuses a standalone overlay at wiring time, not on the first frame', () => {
    const ui = createOverlay({ now: clock.now, driver: 'standalone' });
    expect(() => drive(ui, fakeLoop())).toThrow(/two clocks/);
  });

  it('refuses a loop that takes its callbacks at construction, and says what to do instead', () => {
    const ui = createOverlay({ now: clock.now });
    expect(() => drive(ui, {} as unknown as Driven)).toThrow(/onUpdate/);
    expect(() => drive(ui, null as unknown as Driven)).toThrow(TypeError);
  });

  it('accepts the real @latticekit/loop, which the compiler checks', () => {
    // A structural proof rather than an import: `ui` is layer 3 and may not depend on `loop`.
    // If `Loop` ever stops satisfying `Driven`, this line fails to compile.
    const asDriven = (loop: Loop): Driven => loop;
    expect(typeof asDriven).toBe('function');
  });
});

describe('visibilitychange', () => {
  it('snaps and then advances state when the tab comes back', () => {
    const ui = createOverlay({ now: clock.now });
    const order: string[] = [];
    internalsOf(ui).onResync(() => order.push('resync'));
    ui.every(() => order.push('state'));

    clock.set(3_600_000);
    dom.doc.dispatchEvent(new FakeEvent('visibilitychange'));
    expect(order).toEqual(['resync', 'state']);
  });

  it('does nothing when the tab is going away rather than coming back', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    ui.every(state);
    dom.doc.visibilityState = 'hidden';
    dom.doc.dispatchEvent(new FakeEvent('visibilitychange'));
    expect(state).not.toHaveBeenCalled();
  });

  it('does nothing once destroyed', () => {
    const ui = createOverlay({ now: clock.now });
    const state = vi.fn();
    ui.every(state);
    ui.destroy();
    dom.doc.dispatchEvent(new FakeEvent('visibilitychange'));
    expect(state).not.toHaveBeenCalled();
  });
});

describe('destroy', () => {
  it('leaves no node and no listener behind — invariant 10', () => {
    expect(dom.doc.listenerCount).toBe(0);
    const ui = createOverlay({ now: clock.now });
    expect(dom.doc.listenerCount).toBe(2);
    expect(dom.doc.body.childNodes).toHaveLength(1);

    ui.destroy();
    expect(dom.doc.listenerCount).toBe(0);
    expect(dom.doc.body.childNodes).toHaveLength(0);
  });

  it('does not accumulate a second overlay across a hot reload', () => {
    const first = createOverlay({ now: clock.now });
    first.destroy();
    createOverlay({ now: clock.now });
    expect(dom.doc.body.childNodes).toHaveLength(1);
    expect(dom.doc.listenerCount).toBe(2);
  });

  it('is idempotent', () => {
    const ui = createOverlay({ now: clock.now });
    ui.destroy();
    expect(() => ui.destroy()).not.toThrow();
    expect(dom.doc.listenerCount).toBe(0);
  });
});

describe('internalsOf', () => {
  it('refuses an object that merely looks like an overlay', () => {
    expect(() => internalsOf({} as unknown as Overlay)).toThrow(TypeError);
  });
});

describe('auditOverlay', () => {
  it('says nothing about a clean overlay', () => {
    const ui = createOverlay({ now: clock.now });
    ui.mount(el('div', { class: 'hud' }), { interactive: true });
    expect(auditOverlay(ui)).toEqual([]);
  });

  it('reports a transform on the root, which un-fixes every fixed descendant — trap 10', () => {
    const ui = createOverlay({ now: clock.now });
    fake(ui.root).computed.set('transform', 'translateY(-8px)');
    const problems = auditOverlay(ui);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('containing block');
  });

  it('reports a filter or a will-change on a layer', () => {
    const ui = createOverlay({ now: clock.now });
    fake(ui.layer('modal')).computed.set('filter', 'blur(2px)');
    fake(ui.layer('toasts')).computed.set('will-change', 'transform');
    expect(auditOverlay(ui)).toHaveLength(2);
  });

  it('reports a node granted pointer-events by a stylesheet rather than by interactive()', () => {
    const ui = createOverlay({ now: clock.now });
    const spacer = el('div', { class: 'spacer' });
    fake(ui.layer('panels')).appendChild(fake(spacer));
    fake(spacer).computed.set('pointer-events', 'auto');
    const problems = auditOverlay(ui);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('div.spacer');
    expect(problems[0]).toContain('interactive()');
  });

  it('names an unclassed node by its tag, so the sentence still points somewhere', () => {
    const ui = createOverlay({ now: clock.now });
    const spacer = el('div');
    fake(ui.layer('panels')).appendChild(fake(spacer));
    fake(spacer).computed.set('pointer-events', 'auto');
    expect(auditOverlay(ui)[0]).toContain('div computes to');
  });

  it('does not report the children of a node this package granted', () => {
    const ui = createOverlay({ now: clock.now });
    const child = el('button');
    ui.mount(el('div', undefined, child), { interactive: true });
    fake(child).computed.set('pointer-events', 'auto');
    expect(auditOverlay(ui)).toEqual([]);
  });

  it('returns nothing where the host cannot compute styles at all', () => {
    const ui = createOverlay({ now: clock.now });
    const view = Object.getOwnPropertyDescriptor(dom.doc, 'defaultView');
    expect(view).toBeUndefined();
    Object.defineProperty(dom.doc, 'defaultView', { value: null, configurable: true });
    expect(auditOverlay(ui)).toEqual([]);
  });
});

describe('the README example', () => {
  it('puts a number on the screen, keeps it right, and says something when an event happens', () => {
    // Exactly the code in `packages/ui/README.md`, with two lines changed: the clock is the
    // test's rather than `performance.now`, and the loop is the stand-in above rather than a
    // real `createLoop` — which would need a browser to pump it. Nothing else differs, and
    // this is the run that makes the README's example a claim rather than a hope.
    const wallet = { goldAt: (nowMs: number): number => Math.floor(nowMs / 100) };

    const ui = createOverlay({ now: clock.now });
    const gold = roll(ui, { format: fmtCompact });
    ui.mount(el('div', { class: 'hud' }, 'Gold ', gold.node), { interactive: true });
    ui.every((nowMs) => {
      gold.set(wallet.goldAt(nowMs));
    });
    const loop = fakeLoop();
    drive(ui, loop);
    toasts(ui).show('Refinery online', 'good');
    expect(fake(ui.layer('toasts')).children.length).toBe(1);

    clock.set(120_000);
    loop.update(1 / 60, 1);

    expect(gold.value).toBe(1200);
    expect(gold.node.textContent).toBe(fmtCompact(1200));
    // Two minutes later the toast has expired on the state cadence, unread and unmissed.
    expect(fake(ui.layer('toasts')).children.length).toBe(0);
    expect(auditOverlay(ui)).toEqual([]);

    ui.destroy();
    expect(dom.doc.body.childNodes).toHaveLength(0);
  });
});
