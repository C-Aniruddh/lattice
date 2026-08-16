import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hostComputedStyle,
  hostDocument,
  hostFrameLoop,
  hostInterval,
  hostPixelRatio,
} from '../src/host.js';
import { installDom, type DomHandle } from './dom.js';

let dom: DomHandle | undefined;

afterEach(() => {
  dom?.restore();
  dom = undefined;
});

describe('hostDocument', () => {
  it('returns the document when there is one', () => {
    dom = installDom();
    expect(hostDocument()).toBe(dom.doc);
  });

  it('says this is a browser package rather than failing deep inside a widget', () => {
    // No `installDom()` here: this is Node as the kit's own suite finds it.
    expect(() => hostDocument()).toThrow(/browser package/);
  });
});

describe('hostPixelRatio', () => {
  it('reads the window ratio unclamped — the clamp is a thumbnail policy, not a host fact', () => {
    dom = installDom(3);
    expect(hostPixelRatio()).toBe(3);
  });

  it('falls back to 1 where there is no window, and where the value is nonsense', () => {
    expect(hostPixelRatio()).toBe(1);
    dom = installDom(Number.NaN);
    expect(hostPixelRatio()).toBe(1);
    dom.restore();
    dom = installDom(0);
    expect(hostPixelRatio()).toBe(1);
  });
});

describe('hostComputedStyle', () => {
  it('resolves a style through the element’s own view', () => {
    dom = installDom();
    const node = dom.doc.createElement('div');
    node.style.setProperty('pointer-events', 'auto');
    const computed = hostComputedStyle(node as unknown as Element);
    expect(computed?.getPropertyValue('pointer-events')).toBe('auto');
  });

  it('returns undefined rather than throwing where the host cannot compute styles', () => {
    dom = installDom();
    const node = dom.doc.createElement('div');
    const orphan = { ownerDocument: { defaultView: null } } as unknown as Element;
    expect(hostComputedStyle(orphan)).toBeUndefined();
    const viewless = {
      ownerDocument: { defaultView: {} },
    } as unknown as Element;
    expect(hostComputedStyle(viewless)).toBeUndefined();
    expect(hostComputedStyle(node as unknown as Element)).toBeDefined();
  });
});

describe('hostInterval', () => {
  it('starts one timer and cancels it once, however many times the disposer is called', () => {
    dom = installDom();
    const fn = vi.fn();
    const stop = hostInterval(fn, 1000);
    expect(dom.intervals).toBe(1);
    dom.fireInterval();
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    stop();
    expect(dom.liveTimers()).toBe(0);
    dom.fireInterval();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('names the missing host rather than throwing a TypeError from inside', () => {
    // Node has a `setInterval`, so the host without one has to be built. A worker, a server
    // renderer and a restricted embed are all real places this lands.
    dom = installDom();
    Object.defineProperty(globalThis, 'setInterval', { value: undefined, configurable: true });
    expect(() => hostInterval(() => undefined, 1000)).toThrow(/setInterval/);
  });

  it('still returns a working disposer where the host has no clearInterval', () => {
    dom = installDom();
    Object.defineProperty(globalThis, 'clearInterval', { value: undefined, configurable: true });
    const stop = hostInterval(() => undefined, 1000);
    expect(() => stop()).not.toThrow();
  });
});

describe('hostFrameLoop', () => {
  it('reschedules itself every frame and stops on dispose', () => {
    dom = installDom();
    const fn = vi.fn();
    const stop = hostFrameLoop(fn);
    expect(dom.frames).toBe(1);
    dom.fireFrame();
    dom.fireFrame();
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    stop();
    expect(dom.liveTimers()).toBe(0);
    dom.fireFrame();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not pass the frame timestamp on — invariant 16, one clock per widget', () => {
    dom = installDom();
    const seen: unknown[] = [];
    hostFrameLoop((...args: unknown[]) => seen.push(args.length));
    dom.fireFrame();
    expect(seen).toEqual([0]);
  });

  it('names the missing host', () => {
    expect(() => hostFrameLoop(() => undefined)).toThrow(/requestAnimationFrame/);
  });

  it('ignores a frame that was already queued when it was stopped', () => {
    // A host with no `cancelAnimationFrame` still delivers the callback it promised. The loop
    // has to decline it rather than reschedule itself forever off a disposed overlay.
    dom = installDom();
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      value: undefined,
      configurable: true,
    });
    const fn = vi.fn();
    const stop = hostFrameLoop(fn);
    expect(() => stop()).not.toThrow();
    dom.fireFrame();
    expect(fn).not.toHaveBeenCalled();
    expect(dom.liveTimers()).toBe(0);
  });
});
