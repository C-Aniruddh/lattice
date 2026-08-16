import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOverlay, type Overlay } from '../src/overlay.js';
import { toasts } from '../src/toast.js';
import { FakeEvent, fakeClock, installDom, type DomHandle, type FakeElement } from './dom.js';

let dom: DomHandle;
let clock: ReturnType<typeof fakeClock>;
let ui: Overlay;

beforeEach(() => {
  dom = installDom();
  clock = fakeClock(0);
  ui = createOverlay({ now: clock.now });
});

afterEach(() => {
  dom.restore();
});

function column(): FakeElement {
  return ui.layer('toasts') as unknown as FakeElement;
}

function live(): FakeElement[] {
  const out: FakeElement[] = [];
  const kids = column().children;
  for (let i = 0; i < kids.length; i++) {
    const node = kids.item(i);
    if (node !== null) out.push(node);
  }
  return out;
}

describe('toasts.show', () => {
  it('mounts one toast in the top layer, interactive, with a life bar', () => {
    const host = toasts(ui);
    host.show('Refinery online', 'good');
    const nodes = live();
    expect(nodes).toHaveLength(1);
    const toast = nodes[0];
    expect(toast?.className).toBe('lattice-toast lattice-toast-good');
    expect(toast?.textContent).toBe('Refinery online');
    expect(toast?.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(toast?.children.item(0)?.className).toBe('lattice-toast-bar');
  });

  it('defaults to the plain kind', () => {
    toasts(ui).show('+40 MW');
    expect(live()[0]?.className).toBe('lattice-toast lattice-toast-plain');
  });

  it('lives for minMs plus msPerChar per character', () => {
    // 7000 + 55 × 15 = 7825. The floor is what a sentence needs; the per-character part is what
    // makes a sentence outlive "+40 MW", which is the whole point of scaling it at all.
    const host = toasts(ui);
    host.show('Refinery online');
    ui.tick(7824);
    expect(live()).toHaveLength(1);
    ui.tick(7825);
    expect(live()).toHaveLength(0);
    void host;
  });

  it('expires on the state cadence and never on paint — trap 14', () => {
    // Web Animations do not run in a hidden tab, so an onfinish-driven expiry never fires there.
    toasts(ui, { minMs: 100, msPerChar: 0 }).show('x');
    ui.repaint(10_000);
    expect(live()).toHaveLength(1);
    ui.tick(10_000);
    expect(live()).toHaveLength(0);
  });

  it('clears a whole backlog in one tick after a hidden minute — invariant 5', () => {
    const host = toasts(ui, { max: 8, minMs: 1000, msPerChar: 0 });
    for (let i = 0; i < 8; i++) host.show(`m${String(i)}`);
    expect(live()).toHaveLength(8);
    ui.tick(60_000);
    expect(live()).toHaveLength(0);
  });

  it('sweeps only what is due, leaving the rest of the column alone', () => {
    const host = toasts(ui, { max: 4, minMs: 100, msPerChar: 100 });
    host.show('a');
    host.show('bbbb');
    // 'a' lives 200 ms, 'bbbb' lives 500 ms.
    ui.tick(200);
    expect(live().map((n) => n.textContent)).toEqual(['bbbb']);
    ui.tick(500);
    expect(live()).toHaveLength(0);
  });

  it('caps the column and drops the oldest — the newest is what the player is looking for', () => {
    const host = toasts(ui, { max: 3 });
    for (const text of ['a', 'b', 'c', 'd', 'e']) host.show(text);
    expect(live().map((n) => n.textContent)).toEqual(['c', 'd', 'e']);
  });

  it('holds while a pointer rests on it, and gives back exactly the time it held', () => {
    const host = toasts(ui, { minMs: 1000, msPerChar: 0 });
    host.show('read me');
    const toast = live()[0];
    expect(toast).toBeDefined();

    clock.set(500);
    toast?.dispatchEvent(new FakeEvent('pointerenter'));
    ui.tick(5000);
    expect(live()).toHaveLength(1);

    clock.set(5000);
    toast?.dispatchEvent(new FakeEvent('pointerleave'));
    // It had 500 ms left when the pointer arrived and rested 4500 ms; it must have 500 ms left.
    ui.tick(5499);
    expect(live()).toHaveLength(1);
    ui.tick(5500);
    expect(live()).toHaveLength(0);
  });

  it('pauses and resumes the life bar with the hold', () => {
    toasts(ui).show('read me');
    const toast = live()[0];
    const bar = toast?.children.item(0);
    const anim = bar?.animations[0];
    expect(anim?.state).toBe('running');
    toast?.dispatchEvent(new FakeEvent('pointerenter'));
    expect(anim?.state).toBe('paused');
    toast?.dispatchEvent(new FakeEvent('pointerleave'));
    expect(anim?.state).toBe('running');
  });

  it('ignores a repeated enter and a leave that never entered', () => {
    const host = toasts(ui, { minMs: 1000, msPerChar: 0 });
    host.show('x');
    const toast = live()[0];
    toast?.dispatchEvent(new FakeEvent('pointerleave'));
    clock.set(100);
    toast?.dispatchEvent(new FakeEvent('pointerenter'));
    clock.set(200);
    toast?.dispatchEvent(new FakeEvent('pointerenter'));
    clock.set(300);
    toast?.dispatchEvent(new FakeEvent('pointerleave'));
    // Held from 100 to 300, so it expires 200 ms later than it would have.
    ui.tick(1199);
    expect(live()).toHaveLength(1);
    ui.tick(1200);
    expect(live()).toHaveLength(0);
  });

  it('dismisses on a tap rather than making the reader wait it out', () => {
    toasts(ui).show('read me');
    live()[0]?.dispatchEvent(new FakeEvent('click'));
    expect(live()).toHaveLength(0);
  });

  it('ignores a second tap on a toast already gone', () => {
    toasts(ui).show('x');
    const toast = live()[0];
    toast?.dispatchEvent(new FakeEvent('click'));
    expect(() => toast?.dispatchEvent(new FakeEvent('click'))).not.toThrow();
  });

  it('still expires on a host with no Web Animations', () => {
    dom.doc.animations = false;
    const host = createOverlay({ now: clock.now });
    toasts(host, { minMs: 500, msPerChar: 0 }).show('x');
    host.tick(500);
    expect((host.layer('toasts') as unknown as FakeElement).children.length).toBe(0);
  });

  it('rejects a text that is not a string', () => {
    expect(() => toasts(ui).show(7 as unknown as string)).toThrow(TypeError);
  });

  it('does nothing on a destroyed overlay', () => {
    const host = toasts(ui);
    ui.destroy();
    expect(() => host.show('x')).not.toThrow();
  });
});

describe('toasts.once', () => {
  it('shows once per key across a thousand calls, and a different key still shows — invariant 6', () => {
    const host = toasts(ui, { max: 8 });
    let trues = 0;
    for (let i = 0; i < 1000; i++) {
      if (host.once('storage-not-persistent', 'This browser will not keep your save')) trues += 1;
    }
    expect(trues).toBe(1);
    expect(live()).toHaveLength(1);
    expect(host.once('quota-exceeded', 'Storage is full', 'bad')).toBe(true);
    expect(live()).toHaveLength(2);
  });

  it('latches on the condition even when the text changes every time', () => {
    // The autosave rediscovers the condition every thirty seconds and interpolates a fresh byte
    // count. Keyed on the text this would show forever; keyed on the condition it shows once.
    const host = toasts(ui, { max: 8 });
    for (let attempt = 1; attempt <= 20; attempt++) {
      host.once('storage-not-persistent', `Save blocked (attempt ${String(attempt)})`);
    }
    expect(live()).toHaveLength(1);
    expect(live()[0]?.textContent).toBe('Save blocked (attempt 1)');
  });

  it('does not un-latch when the screen is cleared', () => {
    const host = toasts(ui);
    expect(host.once('k', 'first')).toBe(true);
    host.clear();
    expect(host.once('k', 'again')).toBe(false);
    expect(live()).toHaveLength(0);
  });

  it('rejects an empty or non-string key, which is a condition with no name', () => {
    const host = toasts(ui);
    expect(() => host.once('', 'x')).toThrow(TypeError);
    expect(() => host.once(undefined as unknown as string, 'x')).toThrow(/non-empty string/);
  });

  it('does not burn the key on a destroyed overlay', () => {
    const host = toasts(ui);
    ui.destroy();
    expect(host.once('k', 'x')).toBe(false);
  });
});

describe('toast host lifetime', () => {
  it('clears the screen without unsubscribing', () => {
    const host = toasts(ui, { max: 5, minMs: 100, msPerChar: 0 });
    host.show('a');
    host.show('b');
    host.clear();
    expect(live()).toHaveLength(0);
    host.show('c');
    expect(live()).toHaveLength(1);
  });

  it('cancels the life-bar animations it drops', () => {
    const host = toasts(ui);
    host.show('a');
    const anim = live()[0]?.children.item(0)?.animations[0];
    host.clear();
    expect(anim?.state).toBe('canceled');
  });

  it('stops sweeping once destroyed, and is idempotent', () => {
    const host = toasts(ui, { minMs: 100, msPerChar: 0 });
    host.show('a');
    host.destroy();
    expect(live()).toHaveLength(0);
    expect(() => host.destroy()).not.toThrow();
    host.show('b');
    // The host is gone: `show` still builds a node, but nothing sweeps it, which is why
    // `destroy` is the end of a host's life rather than a pause.
    ui.tick(10_000);
    expect(live()).toHaveLength(1);
  });

  it('goes with the overlay — invariant 10', () => {
    const host = toasts(ui);
    host.show('a');
    ui.destroy();
    expect(dom.doc.body.childNodes).toHaveLength(0);
  });

  it('rejects options that would make a toast undeliverable', () => {
    expect(() => toasts(ui, { max: 0 })).toThrow(RangeError);
    expect(() => toasts(ui, { max: Number.NaN })).toThrow(RangeError);
    expect(() => toasts(ui, { minMs: -1 })).toThrow(RangeError);
    expect(() => toasts(ui, { msPerChar: -1 })).toThrow(RangeError);
  });

  it('accepts a max of exactly one', () => {
    const host = toasts(ui, { max: 1 });
    host.show('a');
    host.show('b');
    expect(live().map((n) => n.textContent)).toEqual(['b']);
    void vi.fn();
  });
});
