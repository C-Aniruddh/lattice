import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { el } from '../src/el.js';
import { createOverlay, type Overlay } from '../src/overlay.js';
import { acknowledge, panel } from '../src/panel.js';
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

function fake(node: HTMLElement): FakeElement {
  return node as unknown as FakeElement;
}

/** The first descendant carrying a class. The tests reach for nodes the way a game's stylesheet
 *  does — by the published class names — so a rename fails here as loudly as it would in a game. */
function byClass(root: FakeElement, name: string): FakeElement {
  for (const node of root.descendants()) {
    if (node.classList.contains(name)) return node;
  }
  throw new Error(`no .${name} in the tree`);
}

function visible(node: FakeElement): boolean {
  return !node.hasAttribute('hidden');
}

describe('panel', () => {
  it('mounts hidden, interactive, in the panels layer, with the published class', () => {
    const sheet = panel(ui);
    expect(fake(sheet.node).className).toBe('lattice-panel');
    expect(fake(sheet.node).parentNode).toBe(fake(ui.layer('panels')));
    expect(sheet.node.style.getPropertyValue('pointer-events')).toBe('auto');
    expect(visible(fake(sheet.node))).toBe(false);
    expect(sheet.isOpen).toBe(false);
  });

  it('gives a modal a scrim, a dialog role and the modal layer', () => {
    const sheet = panel(ui, { modal: true });
    expect(fake(sheet.node).className).toBe('lattice-panel lattice-panel-modal');
    expect(fake(sheet.node).getAttribute('role')).toBe('dialog');
    expect(fake(sheet.node).getAttribute('aria-modal')).toBe('true');
    expect(fake(sheet.node).parentNode).toBe(fake(ui.layer('modal')));
    const scrim = byClass(fake(ui.layer('modal')), 'lattice-scrim');
    // The scrim is mounted before the panel, so the panel paints over it.
    expect(fake(ui.layer('modal')).children.item(0)).toBe(scrim);
    expect(scrim.style.getPropertyValue('pointer-events')).toBe('auto');
  });

  it('honours an explicit layer over the modal default', () => {
    const sheet = panel(ui, { modal: true, layer: 'toasts' });
    expect(fake(sheet.node).parentNode).toBe(fake(ui.layer('toasts')));
  });

  it('opens and closes, and reports it', () => {
    const sheet = panel(ui);
    sheet.open();
    expect(sheet.isOpen).toBe(true);
    expect(visible(fake(sheet.node))).toBe(true);
    sheet.close();
    expect(sheet.isOpen).toBe(false);
    expect(visible(fake(sheet.node))).toBe(false);
  });

  it('is idempotent in both directions, and pushes one modal entry however often it is opened', () => {
    const sheet = panel(ui, { modal: true });
    sheet.open();
    sheet.open();
    expect(ui.modalOpen).toBe(true);
    sheet.close();
    expect(ui.modalOpen).toBe(false);
    expect(() => sheet.close()).not.toThrow();
  });

  it('shows and hides the scrim with the panel', () => {
    const sheet = panel(ui, { modal: true });
    const scrim = byClass(fake(ui.layer('modal')), 'lattice-scrim');
    expect(visible(scrim)).toBe(false);
    sheet.open();
    expect(visible(scrim)).toBe(true);
    sheet.close();
    expect(visible(scrim)).toBe(false);
  });

  it('calls onClose once per close, whatever closed it', () => {
    const onClose = vi.fn();
    const sheet = panel(ui, { onClose });
    sheet.open();
    sheet.close();
    sheet.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    sheet.open();
    sheet.destroy();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not call onClose for a panel that was never open', () => {
    const onClose = vi.fn();
    panel(ui, { onClose }).destroy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('openOnce', () => {
  it('opens exactly once across a thousand polls — invariant 6', () => {
    const sheet = panel(ui);
    let trues = 0;
    for (let i = 0; i < 1000; i++) if (sheet.openOnce()) trues += 1;
    expect(trues).toBe(1);
  });

  it('stays latched after the player has closed it — the poll that races the settle', () => {
    // The company-name bug, exactly: the condition has not cleared yet, the poll fires again
    // after the confirm, and the panel must not reopen blank.
    const sheet = panel(ui);
    expect(sheet.openOnce()).toBe(true);
    sheet.close();
    expect(sheet.openOnce()).toBe(false);
    expect(sheet.isOpen).toBe(false);
  });

  it('interleaves with open() without unlatching', () => {
    const sheet = panel(ui);
    sheet.open();
    expect(sheet.openOnce()).toBe(true);
    sheet.close();
    sheet.open();
    expect(sheet.openOnce()).toBe(false);
  });

  it('is correct when driven from ui.every at a rate faster than the state that clears it', () => {
    const sheet = panel(ui);
    let opens = 0;
    let naming = true;
    ui.every(() => {
      if (naming && sheet.openOnce()) opens += 1;
    });
    for (let t = 0; t < 40; t++) {
      // The state settles halfway through, long after the panel was answered and closed.
      if (t === 20) naming = false;
      if (t === 5) sheet.close();
      ui.tick(t * 900);
    }
    expect(opens).toBe(1);
  });
});

describe('the modal stack', () => {
  it('closes the top only on Escape, and leaves the one underneath', () => {
    const bottom = panel(ui, { modal: true });
    const top = panel(ui, { modal: true });
    bottom.open();
    top.open();
    dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(top.isOpen).toBe(false);
    expect(bottom.isOpen).toBe(true);
    expect(ui.modalOpen).toBe(true);
    dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(bottom.isOpen).toBe(false);
    expect(ui.modalOpen).toBe(false);
  });

  it('ignores Escape for a panel that must be answered', () => {
    const sheet = panel(ui, { modal: true, dismissible: false });
    sheet.open();
    dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(sheet.isOpen).toBe(true);
  });

  it('ignores every other key', () => {
    const sheet = panel(ui, { modal: true });
    sheet.open();
    dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Enter' }));
    expect(sheet.isOpen).toBe(true);
  });

  it('ignores Escape with nothing open', () => {
    expect(() => dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }))).not.toThrow();
  });

  it('closes on a scrim click when dismissible, and does nothing when not', () => {
    const dismissible = panel(ui, { modal: true });
    dismissible.open();
    byClass(fake(ui.layer('modal')), 'lattice-scrim').dispatchEvent(new FakeEvent('click'));
    expect(dismissible.isOpen).toBe(false);

    const answered = panel(ui, { modal: true, dismissible: false });
    answered.open();
    const scrims = fake(ui.layer('modal'))
      .descendants()
      .filter((n) => n.classList.contains('lattice-scrim'));
    scrims[scrims.length - 1]?.dispatchEvent(new FakeEvent('click'));
    expect(answered.isOpen).toBe(true);
  });

  it('leaves a non-modal panel out of the stack entirely', () => {
    const sheet = panel(ui);
    sheet.open();
    expect(ui.modalOpen).toBe(false);
    dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    expect(sheet.isOpen).toBe(true);
  });
});

describe('focus', () => {
  it('moves focus into the panel on open and restores it on close', () => {
    const before = dom.doc.createElement('button');
    before.focus();
    const sheet = panel(ui, { modal: true });
    const button = el('button', { text: 'Buy' });
    sheet.node.appendChild(button);

    sheet.open();
    expect(dom.doc.activeElement).toBe(fake(button));
    sheet.close();
    expect(dom.doc.activeElement).toBe(before);
  });

  it('leaves focus alone when what had it cannot take it back', () => {
    // `document.activeElement` is an `Element`, which has no `focus` — an SVG node in some
    // engines, or nothing at all. Teardown is the worst possible moment for a `TypeError`.
    dom.doc.activeElement = { tagName: 'SVG' } as unknown as FakeElement;
    const sheet = panel(ui, { modal: true });
    sheet.node.appendChild(el('button'));
    sheet.open();
    expect(() => sheet.close()).not.toThrow();
  });

  it('focuses the panel itself when it holds nothing focusable', () => {
    const sheet = panel(ui, { modal: true });
    sheet.node.appendChild(el('div', { text: 'nothing to press' }));
    sheet.open();
    expect(dom.doc.activeElement).toBe(fake(sheet.node));
  });

  it('skips a disabled control and a hidden subtree', () => {
    const sheet = panel(ui, { modal: true });
    const disabled = el('button', { disabled: true });
    (disabled as unknown as { disabled: boolean }).disabled = true;
    const hiddenWrap = el('div', { hidden: true }, el('button', { text: 'inside' }));
    const real = el('button', { text: 'ok' });
    sheet.node.appendChild(disabled);
    sheet.node.appendChild(hiddenWrap);
    sheet.node.appendChild(real);
    sheet.open();
    expect(dom.doc.activeElement).toBe(fake(real));
  });

  it('finds a node made focusable with tabindex', () => {
    const sheet = panel(ui, { modal: true });
    const div = el('div', { tabindex: 0 });
    sheet.node.appendChild(div);
    sheet.open();
    expect(dom.doc.activeElement).toBe(fake(div));
  });

  it('wraps Tab at both ends of the panel and nowhere in between', () => {
    const sheet = panel(ui, { modal: true });
    const first = el('button', { text: 'a' });
    const middle = el('button', { text: 'b' });
    const last = el('button', { text: 'c' });
    sheet.node.appendChild(first);
    sheet.node.appendChild(middle);
    sheet.node.appendChild(last);
    sheet.open();
    expect(dom.doc.activeElement).toBe(fake(first));

    const shiftTab = new FakeEvent('keydown', { key: 'Tab', shiftKey: true });
    fake(first).dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(dom.doc.activeElement).toBe(fake(last));

    const tab = new FakeEvent('keydown', { key: 'Tab' });
    fake(last).dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(dom.doc.activeElement).toBe(fake(first));

    fake(middle).focus();
    const passthroughTab = new FakeEvent('keydown', { key: 'Tab' });
    fake(middle).dispatchEvent(passthroughTab);
    expect(passthroughTab.defaultPrevented).toBe(false);
    expect(dom.doc.activeElement).toBe(fake(middle));
  });

  it('does not trap Tab in a closed panel', () => {
    const sheet = panel(ui, { modal: true });
    const tab = new FakeEvent('keydown', { key: 'Tab' });
    fake(sheet.node).dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('traps Tab on the panel itself when there is nothing else to focus', () => {
    // A modal with nothing focusable still blocks the world, so Tab must not walk out to the
    // page behind the scrim — it cycles from the panel to the panel.
    const sheet = panel(ui, { modal: true });
    sheet.open();
    const tab = new FakeEvent('keydown', { key: 'Tab' });
    fake(sheet.node).dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(dom.doc.activeElement).toBe(fake(sheet.node));
  });

  it('does not trap a key that is not Tab', () => {
    const sheet = panel(ui, { modal: true });
    sheet.node.appendChild(el('button'));
    sheet.open();
    const event = new FakeEvent('keydown', { key: 'a' });
    fake(sheet.node).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('panel teardown', () => {
  it('removes its own nodes and is idempotent', () => {
    const sheet = panel(ui, { modal: true });
    sheet.open();
    sheet.destroy();
    expect(fake(sheet.node).parentNode).toBeNull();
    expect(fake(ui.layer('modal')).childNodes).toHaveLength(0);
    expect(ui.modalOpen).toBe(false);
    expect(() => sheet.destroy()).not.toThrow();
  });

  it('is destroyed with the overlay — invariant 10', () => {
    const onClose = vi.fn();
    const sheet = panel(ui, { modal: true, onClose });
    sheet.open();
    ui.destroy();
    expect(sheet.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dom.doc.body.childNodes).toHaveLength(0);
  });

  it('releases its scope registration, so destroying it twice through the overlay is safe', () => {
    const sheet = panel(ui);
    sheet.destroy();
    expect(() => ui.destroy()).not.toThrow();
  });

  it('refuses to build on a destroyed overlay', () => {
    ui.destroy();
    expect(() => panel(ui)).toThrow(/destroyed/);
  });
});

describe('acknowledge', () => {
  function confirmButton(): FakeElement {
    return byClass(fake(ui.layer('modal')), 'lattice-ack-confirm');
  }

  it('builds the four published nodes and takes focus — invariant 8', () => {
    void acknowledge(ui, { title: 'Saving has stopped', body: 'A newer version wrote this save.' });
    const box = byClass(fake(ui.layer('modal')), 'lattice-ack');
    expect(byClass(box, 'lattice-ack-title').textContent).toBe('Saving has stopped');
    expect(byClass(box, 'lattice-ack-body').textContent).toBe('A newer version wrote this save.');
    expect(confirmButton().textContent).toBe('OK');
    expect(dom.doc.activeElement).toBe(confirmButton());
    expect(ui.modalOpen).toBe(true);
  });

  it('works before the first tick, which is the whole point of it', async () => {
    const seen: string[] = [];
    const done = acknowledge(ui, { title: 'x', body: 'y', confirmText: 'I understand' }).then(() =>
      seen.push('acknowledged'),
    );
    // No tick(), no repaint(), no loop: the session this dialog is about is the one that is not
    // running.
    expect(confirmButton().textContent).toBe('I understand');
    confirmButton().dispatchEvent(new FakeEvent('click'));
    await done;
    expect(seen).toEqual(['acknowledged']);
  });

  it('cannot be escaped or dismissed — invariant 7', () => {
    void acknowledge(ui, { title: 'x', body: 'y' });
    dom.doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    byClass(fake(ui.layer('modal')), 'lattice-scrim').dispatchEvent(new FakeEvent('click'));
    expect(ui.modalOpen).toBe(true);
    expect(byClass(fake(ui.layer('modal')), 'lattice-ack')).toBeDefined();
  });

  it('resolves exactly once however many times the button is pressed', async () => {
    const resolved = vi.fn();
    const done = acknowledge(ui, { title: 'x', body: 'y' }).then(resolved);
    const button = confirmButton();
    button.dispatchEvent(new FakeEvent('click'));
    button.dispatchEvent(new FakeEvent('click'));
    button.dispatchEvent(new FakeEvent('click'));
    await done;
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(ui.modalOpen).toBe(false);
  });

  it('never settles when the overlay is destroyed unacknowledged', async () => {
    const settled = vi.fn();
    void acknowledge(ui, { title: 'x', body: 'y' }).then(settled, settled);
    const button = confirmButton();
    ui.destroy();
    button.dispatchEvent(new FakeEvent('click'));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
  });

  it('stacks over an open modal and leaves it there', async () => {
    const under = panel(ui, { modal: true });
    under.open();
    const done = acknowledge(ui, { title: 'x', body: 'y' });
    expect(ui.modalOpen).toBe(true);
    confirmButton().dispatchEvent(new FakeEvent('click'));
    await done;
    expect(under.isOpen).toBe(true);
    expect(ui.modalOpen).toBe(true);
  });

  it('takes a node body without parsing anything', () => {
    const body = el('p', { text: 'structured' });
    void acknowledge(ui, { title: 'x', body });
    expect(byClass(fake(ui.layer('modal')), 'lattice-ack-body').childNodes[0]).toBe(fake(body));
  });

  it('names the caller’s mistake for a bad title or body', () => {
    expect(() => acknowledge(ui, { title: 1 as unknown as string, body: 'y' })).toThrow(TypeError);
    expect(() => acknowledge(ui, { title: 'x', body: 7 as unknown as string })).toThrow(
      /string or a Node/,
    );
  });
});
