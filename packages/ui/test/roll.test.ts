import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fmtCompact } from '@lattice/core';
import { el } from '../src/el.js';
import { createOverlay, type Overlay } from '../src/overlay.js';
import { floats, roll, type ScreenPoint } from '../src/roll.js';
import { FakeEvent, fakeClock, installDom, type DomHandle, type FakeElement } from './dom.js';

let dom: DomHandle;
let clock: ReturnType<typeof fakeClock>;
let ui: Overlay;

beforeEach(() => {
  dom = installDom();
  clock = fakeClock(1000);
  ui = createOverlay({ now: clock.now });
});

afterEach(() => {
  dom.restore();
});

function fake(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}

describe('roll', () => {
  it('builds its own span with the published class and starts at zero', () => {
    const gold = roll(ui);
    expect(fake(gold.node).tagName).toBe('SPAN');
    expect(fake(gold.node).className).toBe('lattice-roll');
    expect(gold.node.textContent).toBe('0');
    expect(gold.value).toBe(0);
  });

  it('takes a node you already have, and never mounts it for you', () => {
    const node = el('b');
    const gold = roll(ui, { node });
    expect(gold.node).toBe(node);
    expect(fake(node).parentNode).toBeNull();
  });

  it('reports the target immediately, even while the text is behind — mid-roll truth', () => {
    const gold = roll(ui);
    ui.repaint(1000);
    gold.set(1240);
    expect(gold.value).toBe(1240);
    expect(gold.node.textContent).toBe('0');
  });

  it('eases on the paint cadence with the kit’s own curve', () => {
    // cubicOut(0.5) = 1 − 0.5³ = 0.875, so half way through a 0 → 1000 roll reads 875. The
    // number is exact in binary, which is why this is an equality and not a tolerance.
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000); // a frame has painted, so there is something to animate on
    gold.set(1000);
    ui.repaint(1200);
    expect(gold.node.textContent).toBe('875');
    ui.repaint(1100);
    expect(gold.node.textContent).toBe('578');
    ui.repaint(1400);
    expect(gold.node.textContent).toBe('1000');
  });

  it('is correct with the paint cadence never running — invariant 2', () => {
    // A hidden tab is a `render` that never fires. Every number on screen must still be right,
    // and *immediately*: a game sets its readouts from `ui.every`, which runs after this
    // widget's own subscriber, so a HUD that waited for the next tick would sit one update
    // behind the truth for as long as the tab stayed hidden.
    const gold = roll(ui, { ms: 400 });
    ui.every(() => {
      gold.set(1240);
    });
    ui.tick(1010);
    expect(gold.node.textContent).toBe('1240');
    expect(gold.value).toBe(1240);
  });

  it('stops animating when the paint cadence dies mid-roll', () => {
    // The transition into a hidden tab: a frame painted a moment ago, the roll started, and then
    // nothing paints again. The state cadence catches it and snaps.
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000);
    gold.set(500);
    ui.repaint(1100);
    expect(gold.node.textContent).toBe('289');
    ui.tick(1200);
    expect(gold.node.textContent).toBe('289');
    ui.tick(1501);
    expect(gold.node.textContent).toBe('500');
  });

  it('leaves the animation alone once a frame has painted', () => {
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000);
    gold.set(1000);
    ui.repaint(1100);
    ui.tick(1100);
    // The state cadence is the safety net, not a second animator: it does not snap a roll that
    // is being painted, or every roll would jump on the first update after it started.
    expect(gold.node.textContent).toBe('578');
  });

  it('snaps rather than counting up when the tab comes back — invariant 5', () => {
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000);
    gold.set(999);
    ui.repaint(1100);
    clock.set(3_600_000);
    dom.doc.dispatchEvent(new FakeEvent('visibilitychange'));
    expect(gold.node.textContent).toBe('999');
  });

  it('snaps on demand, and snapping a settled roll does nothing', () => {
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000);
    gold.set(50);
    gold.snap();
    expect(gold.node.textContent).toBe('50');
    const writes = dom.doc.textWrites;
    gold.snap();
    expect(dom.doc.textWrites).toBe(writes);
  });

  it('does nothing at all for a value it already has', () => {
    const gold = roll(ui);
    gold.set(0);
    const writes = dom.doc.textWrites;
    ui.tick(2000);
    ui.repaint(2000);
    expect(dom.doc.textWrites).toBe(writes);
  });

  it('lands immediately when ms is zero, from either cadence', () => {
    // A zero-duration roll is a number that jumps. `painting()` is true only for a frame painted
    // at the very instant of the set, and even then the first paint lands it rather than
    // dividing by a duration of zero.
    const gold = roll(ui, { ms: 0 });
    gold.set(7);
    expect(gold.node.textContent).toBe('7');

    ui.repaint(1000);
    gold.set(9);
    expect(gold.node.textContent).toBe('7');
    ui.repaint(1000);
    expect(gold.node.textContent).toBe('9');
  });

  it('formats through the caller’s formatter, never one of its own', () => {
    const gold = roll(ui, { format: fmtCompact, ms: 400 });
    gold.set(1_500_000);
    gold.snap();
    expect(gold.node.textContent).toBe(fmtCompact(1_500_000));
  });

  it('rounds only when both ends are whole numbers', () => {
    const whole = roll(ui, { ms: 400 });
    const fractional = roll(ui, { ms: 400 });
    ui.repaint(1000);
    whole.set(1000);
    ui.repaint(1200);
    expect(whole.node.textContent).toBe('875');

    fractional.set(2.5);
    ui.repaint(1200);
    expect(fractional.node.textContent).toBe(String(2.5 * 0.875));
  });

  it('counts down as happily as it counts up', () => {
    const gold = roll(ui, { ms: 400 });
    gold.set(1000);
    ui.repaint(1000);
    gold.set(0);
    ui.repaint(1200);
    expect(gold.node.textContent).toBe('125');
  });

  it('pulses on every settled change, and not before', () => {
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000);
    const before = dom.doc.reflows;
    gold.set(10);
    ui.repaint(1200);
    expect(dom.doc.reflows).toBe(before);
    ui.repaint(1400);
    expect(dom.doc.reflows).toBe(before + 1);
    expect(fake(gold.node).classList.contains('bump')).toBe(true);
  });

  it('skips the forced layout entirely when the bump class is empty', () => {
    const gold = roll(ui, { ms: 400, bumpClass: '' });
    const before = dom.doc.reflows;
    gold.set(10);
    gold.snap();
    expect(dom.doc.reflows).toBe(before);
  });

  it('refuses a NaN, which would reach a currency display as the word NaN', () => {
    const gold = roll(ui);
    expect(() => gold.set(Number.NaN)).toThrow(RangeError);
    expect(() => gold.set(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => roll(ui, { ms: -1 })).toThrow(RangeError);
    expect(() => roll(ui, { ms: Number.NaN })).toThrow(RangeError);
  });

  it('handles a huge target without losing the target', () => {
    const gold = roll(ui, { ms: 400 });
    gold.set(Number.MAX_SAFE_INTEGER);
    gold.snap();
    expect(gold.value).toBe(Number.MAX_SAFE_INTEGER);
    expect(gold.node.textContent).toBe(String(Number.MAX_SAFE_INTEGER));
  });

  it('unsubscribes from both cadences on destroy, idempotently, and with the overlay', () => {
    const gold = roll(ui, { ms: 400 });
    ui.repaint(1000);
    gold.set(500);
    gold.destroy();
    ui.tick(2000);
    ui.repaint(2000);
    expect(gold.node.textContent).toBe('0');
    expect(() => gold.destroy()).not.toThrow();

    const other = roll(ui, { ms: 400 });
    other.set(500);
    ui.destroy();
    expect(() => other.destroy()).not.toThrow();
  });
});

describe('floats', () => {
  it('creates the whole pool up front, hidden, in the bottom layer', () => {
    const host = floats(ui, { capacity: 4 });
    const layer = fake(ui.layer('floats'));
    expect(layer.children.length).toBe(4);
    expect(layer.children.item(0)?.className).toBe('lattice-float lattice-float-plain');
    expect(layer.children.item(0)?.hasAttribute('hidden')).toBe(true);
    void host;
  });

  it('allocates no element after warm-up, however many spawn — invariant 9', () => {
    const host = floats(ui, { capacity: 8 });
    const created = dom.doc.created;
    for (let i = 0; i < 1000; i++) host.spawn(i, i, `+${String(i)}`, i % 2 === 0 ? 'gain' : 'loss');
    expect(dom.doc.created).toBe(created);
    expect(fake(ui.layer('floats')).children.length).toBe(8);
  });

  it('recycles the oldest when the pool is full', () => {
    const host = floats(ui, { capacity: 2 });
    host.spawn(0, 0, 'a');
    host.spawn(0, 0, 'b');
    host.spawn(0, 0, 'c');
    const texts = [0, 1].map((i) => fake(ui.layer('floats')).children.item(i)?.textContent);
    expect(texts).toEqual(['c', 'b']);
  });

  it('positions with left and top only, and marks the kind', () => {
    const host = floats(ui, { capacity: 1 });
    host.spawn(120, 48, '+120', 'gain');
    const node = fake(ui.layer('floats')).children.item(0);
    expect(node?.className).toBe('lattice-float lattice-float-gain');
    expect(node?.style.getPropertyValue('left')).toBe('120px');
    expect(node?.style.getPropertyValue('top')).toBe('48px');
    expect([...(node?.style.props.keys() ?? [])].sort()).toEqual(['left', 'position', 'top']);
    expect(node?.hasAttribute('hidden')).toBe(false);
  });

  it('starts a Web Animation that moves it without a stylesheet', () => {
    const host = floats(ui, { capacity: 1, ms: 500 });
    host.spawn(0, 0, '+1');
    const anim = fake(ui.layer('floats')).children.item(0)?.animations[0];
    expect(anim?.options).toEqual({ duration: 500, easing: 'ease-out', fill: 'forwards' });
  });

  it('expires from the state cadence, not from the animation — trap 14', () => {
    const host = floats(ui, { capacity: 1, ms: 900 });
    clock.set(1000);
    host.spawn(0, 0, '+1');
    ui.repaint(9_999_999);
    expect(fake(ui.layer('floats')).children.item(0)?.hasAttribute('hidden')).toBe(false);
    ui.tick(1899);
    expect(fake(ui.layer('floats')).children.item(0)?.hasAttribute('hidden')).toBe(false);
    ui.tick(1900);
    const node = fake(ui.layer('floats')).children.item(0);
    expect(node?.hasAttribute('hidden')).toBe(true);
    expect(node?.animations[0]?.state).toBe('canceled');
  });

  it('projects on spawn and again on every paint, into one reused point', () => {
    const seen: ScreenPoint[] = [];
    const project = vi.fn((ax: number, ay: number, out: ScreenPoint) => {
      out.x = ax * 2;
      out.y = ay + 5;
      seen.push(out);
    });
    const host = floats(ui, { capacity: 1, project });
    host.spawn(10, 10, '+1');
    const node = fake(ui.layer('floats')).children.item(0);
    expect(node?.style.getPropertyValue('left')).toBe('20px');
    expect(node?.style.getPropertyValue('top')).toBe('15px');

    project.mockImplementation((ax: number, ay: number, out: ScreenPoint) => {
      out.x = ax + 1;
      out.y = ay + 1;
    });
    ui.repaint(2000);
    expect(node?.style.getPropertyValue('left')).toBe('11px');
    // One output object for every projection ever made, which is what makes `spawn` allocation
    // free on the hot path.
    expect(seen[0]).toBe(seen[seen.length - 1]);
  });

  it('does not register a paint subscriber at all without a projection', () => {
    const host = floats(ui, { capacity: 1 });
    host.spawn(3, 4, '+1');
    ui.repaint(2000);
    const node = fake(ui.layer('floats')).children.item(0);
    expect(node?.style.getPropertyValue('left')).toBe('3px');
  });

  it('reprojects only the live floats', () => {
    const project = vi.fn((ax: number, ay: number, out: ScreenPoint) => {
      out.x = ax;
      out.y = ay;
    });
    const host = floats(ui, { capacity: 4, ms: 100, project });
    host.spawn(0, 0, '+1');
    project.mockClear();
    ui.repaint(1000);
    expect(project).toHaveBeenCalledTimes(1);
    ui.tick(2000);
    project.mockClear();
    ui.repaint(2000);
    expect(project).not.toHaveBeenCalled();
  });

  it('works on a host with no Web Animations', () => {
    dom.doc.animations = false;
    const other = createOverlay({ now: clock.now });
    const host = floats(other, { capacity: 1, ms: 100 });
    expect(() => host.spawn(0, 0, '+1')).not.toThrow();
    other.tick(clock.now() + 100);
    expect(
      (other.layer('floats') as unknown as FakeElement).children.item(0)?.hasAttribute('hidden'),
    ).toBe(true);
  });

  it('refuses a pool that cannot hold anything, or a lifetime of zero', () => {
    expect(() => floats(ui, { capacity: 0 })).toThrow(RangeError);
    expect(() => floats(ui, { capacity: Number.NaN })).toThrow(RangeError);
    expect(() => floats(ui, { ms: 0 })).toThrow(RangeError);
    expect(() => floats(ui, { ms: -1 })).toThrow(RangeError);
  });

  it('refuses a NaN anchor, which the browser would place in the top-left corner', () => {
    const host = floats(ui, { capacity: 1 });
    expect(() => host.spawn(Number.NaN, 0, '+1')).toThrow(RangeError);
    expect(() => host.spawn(0, Number.POSITIVE_INFINITY, '+1')).toThrow(RangeError);
  });

  it('removes the pool on destroy, idempotently, and with the overlay', () => {
    const host = floats(ui, { capacity: 3 });
    host.spawn(0, 0, '+1');
    host.destroy();
    expect(fake(ui.layer('floats')).children.length).toBe(0);
    expect(() => host.destroy()).not.toThrow();
    expect(() => host.spawn(0, 0, '+1')).not.toThrow();

    const other = floats(ui, { capacity: 2 });
    ui.destroy();
    expect(() => other.destroy()).not.toThrow();
  });
});
