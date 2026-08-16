import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, el, hide, interactive, passthrough, pulse, setText, show } from '../src/el.js';
import { FakeEvent, installDom, type DomHandle, type FakeElement } from './dom.js';

let dom: DomHandle;

beforeEach(() => {
  dom = installDom();
});

afterEach(() => {
  dom.restore();
});

/** The fake tree and the DOM types agree structurally; this is the one cast the tests need. */
function fake(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}

describe('el', () => {
  it('builds a tag with a class, text and children in order', () => {
    const inner = el('span', { text: 'x' });
    const node = el('div', { class: 'hud row' }, 'Gold ', inner);
    expect(fake(node).tagName).toBe('DIV');
    expect(fake(node).className).toBe('hud row');
    expect(node.textContent).toBe('Gold x');
    expect(fake(node).childNodes).toHaveLength(2);
  });

  it('skips undefined and false attributes, and sets a bare one for true', () => {
    const node = el('button', {
      'data-kind': 'buy',
      'aria-hidden': undefined,
      hidden: false,
      disabled: true,
      tabindex: 0,
    });
    expect(fake(node).getAttribute('data-kind')).toBe('buy');
    expect(fake(node).hasAttribute('aria-hidden')).toBe(false);
    expect(fake(node).hasAttribute('hidden')).toBe(false);
    expect(fake(node).getAttribute('disabled')).toBe('');
    expect(fake(node).getAttribute('tabindex')).toBe('0');
  });

  it('drops falsy children so `cond && el(…)` reads inline', () => {
    const node = el('div', undefined, 'a', false, null, undefined, 'b');
    expect(node.textContent).toBe('ab');
    expect(fake(node).childNodes).toHaveLength(2);
  });

  it('binds an on* key as a listener, case-insensitively', () => {
    const onclick: EventListener = vi.fn();
    const onPointerDown: EventListener = vi.fn();
    const node = el('button', { onclick, onPointerDown });
    fake(node).dispatchEvent(new FakeEvent('click'));
    fake(node).dispatchEvent(new FakeEvent('pointerdown'));
    expect(onclick).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('refuses an `html` key, because the first string a game interpolates is a typed name', () => {
    expect(() => el('div', { html: '<b>hi</b>' })).toThrow(TypeError);
    expect(() => el('div', { html: '<b>hi</b>' })).toThrow(/innerHTML/);
  });

  it('refuses a function under a key that does not start with `on`', () => {
    const listener: EventListener = () => undefined;
    expect(() => el('button', { click: listener })).toThrow(/does not start with/);
  });

  it('builds with no attributes and no children at all', () => {
    const node = el('div');
    expect(fake(node).childNodes).toHaveLength(0);
    expect(fake(node).className).toBe('');
  });
});

describe('clear', () => {
  it('empties a node one child at a time', () => {
    const node = el('div', undefined, 'a', el('span'), 'c');
    clear(node);
    expect(fake(node).childNodes).toHaveLength(0);
    expect(node.textContent).toBe('');
  });

  it('is a no-op on an empty node', () => {
    const node = el('div');
    expect(() => clear(node)).not.toThrow();
  });
});

describe('setText', () => {
  it('writes once and reports whether it wrote — invariant 13', () => {
    const node = el('span');
    const before = dom.doc.textWrites;
    expect(setText(node, '1,240')).toBe(true);
    expect(dom.doc.textWrites).toBe(before + 1);
    expect(setText(node, '1,240')).toBe(false);
    expect(dom.doc.textWrites).toBe(before + 1);
    expect(setText(node, '1,241')).toBe(true);
    expect(dom.doc.textWrites).toBe(before + 2);
  });

  it('compares against text this package did not write', () => {
    const node = el('span', { text: 'set by the game' });
    expect(setText(node, 'set by the game')).toBe(false);
  });

  it('handles the empty string in both directions', () => {
    const node = el('span', { text: 'x' });
    expect(setText(node, '')).toBe(true);
    expect(node.textContent).toBe('');
    expect(setText(node, '')).toBe(false);
  });
});

describe('show and hide', () => {
  it('hides with an inline !important display and the attribute both', () => {
    const node = el('div');
    hide(node);
    expect(node.style.getPropertyValue('display')).toBe('none');
    expect(fake(node).style.getPropertyPriority('display')).toBe('important');
    expect(fake(node).hasAttribute('hidden')).toBe(true);
  });

  it('beats a stylesheet that says display: flex !important — invariant 14', () => {
    // The cascade itself is the browser's; what this asserts is the mechanism that wins it.
    // A game rule of `display: flex !important` is author-origin and `!important`; an inline
    // `!important` is the only declaration that outranks it, and writing the attribute alone —
    // the naive version — loses to a plain `.dock { display: flex }`.
    const node = el('div');
    fake(node).computed.set('display', 'flex');
    hide(node);
    const computed = dom.doc.defaultView.getComputedStyle(fake(node));
    expect(computed.getPropertyValue('display')).toBe('none');
  });

  it('shows by removing the inline value, so the game’s own stylesheet decides again', () => {
    const node = el('div');
    hide(node);
    show(node);
    expect(node.style.getPropertyValue('display')).toBe('');
    expect(fake(node).hasAttribute('hidden')).toBe(false);
  });

  it('takes an explicit boolean', () => {
    const node = el('div');
    show(node, false);
    expect(fake(node).hasAttribute('hidden')).toBe(true);
    show(node, true);
    expect(fake(node).hasAttribute('hidden')).toBe(false);
  });
});

describe('pulse', () => {
  it('forces a layout between the remove and the add, or the animation never restarts', () => {
    const node = el('div', { class: 'pill bump' });
    const before = dom.doc.reflows;
    pulse(node);
    expect(dom.doc.reflows).toBe(before + 1);
    expect(fake(node).classList.contains('bump')).toBe(true);
  });

  it('adds the class when it was not there', () => {
    const node = el('div', { class: 'pill' });
    pulse(node, 'flash');
    expect(fake(node).className).toBe('pill flash');
  });

  it('skips the forced layout entirely for the empty class name', () => {
    const node = el('div');
    const before = dom.doc.reflows;
    pulse(node, '');
    expect(dom.doc.reflows).toBe(before);
    expect(fake(node).className).toBe('');
  });
});

describe('interactive and passthrough', () => {
  it('writes pointer-events inline on exactly the node it was given', () => {
    const child = el('span');
    const node = el('div', undefined, child);
    expect(interactive(node)).toBe(node);
    expect(node.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(child.style.getPropertyValue('pointer-events')).toBe('');
  });

  it('takes them away again for a decorative child', () => {
    const glow = el('div');
    expect(passthrough(glow)).toBe(glow);
    expect(glow.style.getPropertyValue('pointer-events')).toBe('none');
  });
});
