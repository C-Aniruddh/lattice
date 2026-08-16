/**
 * Sheets, modals, and the things that must be answered.
 *
 * Three behaviors earn this module its place, and none of them is appearance: a **focus trap**,
 * a **stack** whose Escape key and scrim pop the top only, and a **latch** that makes a
 * one-shot dialog safe to drive from a poll. A game styles everything it can see.
 *
 * ## Why `openOnce` exists
 *
 * The source game polled a derived condition every 900 ms to decide whether to show its company
 * namer, while that condition only cleared on a 1000 ms settle. The namer therefore reopened —
 * blank — *after* the player pressed CONFIRM, and the obvious recovery, pressing CONFIRM again,
 * overwrote the name they had just typed with a random roll. **The recovery the bug invited was
 * the bug's payload.** It is not a modal that blinks; it is data loss.
 *
 * `ui.every(() => { if (questIsNaming) namer.openOnce(); })` is correct at any poll rate,
 * including one faster than the state that drives it.
 */

import type { Disposer } from '@lattice/core';
import { el, hide, show } from './el.js';
import { createLatch } from './latch.js';
import { internalsOf, type LayerName, type ModalEntry, type Overlay } from './overlay.js';

/** How a panel behaves. Nothing here describes how it looks. */
export interface PanelOptions {
  /** A modal gets a scrim, traps focus, sets `role="dialog"` and blocks the world. Default
   *  `false`. */
  readonly modal?: boolean;
  /** Scrim click and Escape close it. Default `true`. A confirmation that must be answered
   *  sets `false`. */
  readonly dismissible?: boolean;
  /** Default `'panels'`, or `'modal'` when `modal` is true. */
  readonly layer?: LayerName;
  /** Called after close, whatever closed it — a button, the scrim, Escape, `destroy()`, or the
   *  overlay being torn down. Called at most once per close, never twice for one. */
  readonly onClose?: () => void;
}

/** An open-and-closable region of the overlay. */
export interface Panel {
  /**
   * Your content goes in here.
   *
   * The package owns this element's structural styles — it is mounted, hidden, shown and given
   * pointer events by `panel` — and you own every child of it. It carries `lattice-panel`, and
   * `lattice-panel-modal` when modal, and no other styling whatsoever.
   */
  readonly node: HTMLElement;
  /** Whether it is currently on screen. */
  readonly isOpen: boolean;

  /** Open it. Idempotent: opening an open panel does not push a second modal entry, which
   *  would take two Escapes to close and leave `modalOpen` true after the first. */
  open(): void;

  /**
   * Open at most once, ever, for the life of this panel — and return whether *this* call was
   * the one that opened it.
   *
   * This exists because of a data-loss bug, not for tidiness; see the module header. The latch
   * never resets: a panel that has been opened once and closed will not reopen through this
   * door, including from a poll running faster than the state that drives it.
   */
  openOnce(): boolean;

  /** Close it, restoring focus to whatever had it when the panel opened. Idempotent. */
  close(): void;
  /** Close it and remove its nodes. Idempotent, and safe to call after `ui.destroy()`. */
  destroy(): void;
}

/** Tags that take focus without a `tabindex`. Enough for a HUD; a game that puts something
 *  exotic in a dialog gives it `tabindex="0"` and this finds it. */
const FOCUSABLE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

/** Collect focusable descendants in document order, into `out`, to avoid allocating a fresh
 *  array on every Tab. A dialog is a few nodes; the walk is not the cost, the reflow is. */
function collectFocusable(node: Element, out: HTMLElement[]): void {
  for (const child of node.children) {
    const candidate = child as HTMLElement;
    const disabled = (candidate as { disabled?: boolean }).disabled === true;
    const hidden = child.hasAttribute('hidden');
    const tabindex = child.getAttribute('tabindex');
    const focusable =
      !disabled &&
      !hidden &&
      (FOCUSABLE_TAGS.has(child.tagName) || (tabindex !== null && Number(tabindex) >= 0));
    if (focusable) out.push(candidate);
    // A hidden subtree is not walked at all: a control inside it cannot take focus, and putting
    // it in the ring is how Tab lands on something the player cannot see.
    if (!hidden) collectFocusable(child, out);
  }
}

/** Focus something, if it can be focused. `document.activeElement` is an `Element`, which has
 *  no `focus`, and the restore path is exactly where a missing method would throw during
 *  teardown — the worst possible moment for an exception. */
function focusIfPossible(target: Element | null): void {
  if (target === null) return;
  const candidate = target as Partial<HTMLElement>;
  if (typeof candidate.focus === 'function') candidate.focus.call(target);
}

/**
 * A panel bound to an overlay.
 *
 * Modals are a **stack**: opening a second over the first pushes, Escape and the scrim pop the
 * top only, and `ui.modalOpen` is true while the stack is non-empty. Focus moves into the top
 * panel on open and is restored to the previously focused element on close — including when the
 * close came from `ui.destroy()`, because a game that tears down a screen while a dialog is open
 * should not leave focus on a node that no longer exists.
 *
 * @throws Error if the overlay has already been destroyed.
 */
export function panel(ui: Overlay, opts?: PanelOptions): Panel {
  const internals = internalsOf(ui);
  const modal = opts?.modal ?? false;
  const dismissible = opts?.dismissible ?? true;
  const layer: LayerName = opts?.layer ?? (modal ? 'modal' : 'panels');
  const onClose = opts?.onClose;
  const latch = createLatch();

  const scrim = modal ? el('div', { class: 'lattice-scrim' }) : undefined;
  const node = el('div', {
    class: modal ? 'lattice-panel lattice-panel-modal' : 'lattice-panel',
    ...(modal ? { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' } : {}),
  });

  if (scrim !== undefined) {
    hide(scrim);
    ui.mount(scrim, { layer, interactive: true });
    scrim.addEventListener('click', () => {
      // The scrim is a *dismissal*, not a button: a panel that must be answered ignores it, and
      // the pointer landing on it is then simply a tap that hit nothing.
      if (dismissible) close();
    });
  }
  hide(node);
  ui.mount(node, { layer, interactive: true });

  let isOpen = false;
  let returnFocus: Element | null = null;
  const focusables: HTMLElement[] = [];
  const entry: ModalEntry = {
    dismissible,
    close: () => {
      close();
    },
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || !isOpen) return;
    focusables.length = 0;
    collectFocusable(node, focusables);
    // A dialog with nothing focusable falls back to the panel itself, which is what `open()`
    // focused. Tab then cycles from the panel to the panel — the modal still traps, rather than
    // letting the key walk out to the page behind a scrim that is supposed to block it.
    const first = focusables[0] ?? node;
    const last = focusables[focusables.length - 1] ?? node;
    const active = internals.doc.activeElement;
    // Only the two ends need handling; everything between them is the browser's own order, and
    // reimplementing that is how a dialog starts skipping the third field on some engines.
    if (event.shiftKey && active === first) {
      event.preventDefault();
      focusIfPossible(last);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      focusIfPossible(first);
    }
  };
  if (modal) node.addEventListener('keydown', onKeyDown);

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    if (scrim !== undefined) show(scrim);
    show(node);
    if (modal) {
      returnFocus = internals.doc.activeElement;
      internals.modals.push(entry);
      focusables.length = 0;
      collectFocusable(node, focusables);
      focusIfPossible(focusables[0] ?? node);
    }
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    hide(node);
    if (scrim !== undefined) hide(scrim);
    if (modal) {
      const at = internals.modals.indexOf(entry);
      if (at !== -1) internals.modals.splice(at, 1);
      focusIfPossible(returnFocus);
      returnFocus = null;
    }
    onClose?.();
  }

  let destroyed = false;
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    close();
    node.parentNode?.removeChild(node);
    scrim?.parentNode?.removeChild(scrim);
  }

  // Registered on the overlay's scope so `ui.destroy()` is a complete teardown rather than a
  // list a game has to maintain. Holding the disposer too lets `destroy()` release it early.
  const release: Disposer = internals.scope.add(destroy);

  return {
    node,
    get isOpen(): boolean {
      return isOpen;
    },
    open,
    openOnce(): boolean {
      if (!latch.fire()) return false;
      open();
      return true;
    },
    close,
    destroy(): void {
      release();
      destroy();
    },
  };
}

/** What an acknowledgement says. Three fields, because a fourth is a dialog system. */
export interface AcknowledgeOptions {
  /** Short. It is the line the player reads before deciding whether this matters. */
  readonly title: string;
  /**
   * The explanation, in the player's terms: what has happened, and what it means for them. A
   * `Node` if you need structure — this package will not parse an HTML string for you.
   */
  readonly body: string | Node;
  /**
   * The button. Default `'OK'`, and you should nearly always replace it: a label that names the
   * acknowledgement ("I understand") is read, and "OK" is pressed without being read.
   */
  readonly confirmText?: string;
}

/**
 * Tell the player something that must not be missed, and wait until they say they have seen it.
 *
 * A modal panel with `dismissible: false`, one button, and a promise that resolves when it is
 * pressed. Escape does nothing, the scrim does nothing, there is no close cross — the only way
 * out is the acknowledgement, which is the entire point.
 *
 * **This exists for a specific class of message: the session has silently stopped working and
 * the player cannot tell.** `@lattice/persist`'s `'refusing-newer'` is the case that named it —
 * a save written by a newer deploy, which `persist` correctly refuses to overwrite, so the
 * player's progress is safe and their *current session* is not being recorded. A toast is
 * exactly wrong there: it is dismissible, it expires whether or not it was read, and it competes
 * with the toast that said "Refinery online" three seconds earlier. Severity is a property of
 * what the player loses by missing a message, not of how alarming it sounds.
 *
 * Guarantees worth relying on:
 *
 * - **It works before the loop is running.** Panels are event-driven, not tick-driven, so a
 *   dialog raised at boot — before `drive(ui, loop)`, or when the loop will never start because
 *   whatever it would have run is the thing that failed — is fully functional. A message about a
 *   broken session must not depend on the session.
 * - **The confirm button takes focus on open**, so Enter answers it and a keyboard-only player
 *   is never trapped in a dialog that ignores Escape by design.
 * - **It stacks.** Raised over an open modal it goes on top, and the one underneath is still
 *   there when it closes.
 * - **If the overlay is destroyed first, the promise never settles.** Deliberate, and the one
 *   sharp edge here: a continuation written after `await acknowledge(…)` is written for a player
 *   who agreed, and running it because the page is being torn down would be a lie. If you need
 *   to know about teardown instead, build it from {@link panel} directly.
 *
 * **One action only.** Two buttons is a *choice*, not an acknowledgement, and a choice has an
 * outcome the caller must handle — that is a different function with a different return type,
 * and it is the first step into a dialog system this package refuses to become.
 *
 * @throws TypeError if `title` is not a string or `body` is neither a string nor a node.
 * @throws Error if the overlay has already been destroyed.
 */
export function acknowledge(ui: Overlay, opts: AcknowledgeOptions): Promise<void> {
  if (typeof opts?.title !== 'string') {
    throw new TypeError(`acknowledge: \`title\` must be a string, got ${typeof opts?.title}`);
  }
  const body = opts.body;
  if (typeof body !== 'string' && (typeof body !== 'object' || body === null)) {
    throw new TypeError(
      `acknowledge: \`body\` must be a string or a Node, got ${typeof body} — this package will not parse an HTML string, because the first string a game interpolates is a name the player typed`,
    );
  }
  const internals = internalsOf(ui);
  const sheet = panel(ui, { modal: true, dismissible: false });

  return new Promise<void>((resolve) => {
    let settled = false;
    const confirm = el(
      'button',
      {
        class: 'lattice-ack-confirm',
        type: 'button',
        onclick: () => {
          // Resolve once, whatever happens: a double tap on a phone dispatches two clicks, and
          // a continuation that runs twice is worse than one that runs late.
          if (settled) return;
          // A click that arrives after teardown resolves nothing. The promise's contract is
          // "the player agreed", and a detached button being dispatched at is not that.
          if (!internals.alive()) return;
          settled = true;
          sheet.destroy();
          resolve();
        },
      },
      opts.confirmText ?? 'OK',
    );
    sheet.node.appendChild(
      el(
        'div',
        { class: 'lattice-ack' },
        el('div', { class: 'lattice-ack-title', text: opts.title }),
        typeof body === 'string'
          ? el('div', { class: 'lattice-ack-body', text: body })
          : el('div', { class: 'lattice-ack-body' }, body),
        confirm,
      ),
    );
    sheet.open();
  });
}
