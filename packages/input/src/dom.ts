/**
 * **`@browser-only`** — the one module in this package that knows a browser exists.
 *
 * Everything else here is a pure state machine fed by {@link InputSystem.submit}; this file is
 * a *producer of samples* and nothing more. That is the whole architecture in one sentence, and
 * it is why every invariant in the package is testable in Node with no shim: the DOM's job is
 * to answer "which pixel, which pointer, which key", and it has no opinion about what any of
 * them mean.
 *
 * If a second module in this package ever needs this header, the split has failed and the
 * change should be argued rather than merged.
 *
 * ## The six traps this file exists to close
 *
 * 1. **`clientX`.** Correct only for a full-window canvas at the origin, which is exactly the
 *    configuration the first game happens to have and the second one does not. Every coordinate
 *    is relative to the element's rect — cached, because `getBoundingClientRect()` per
 *    `pointermove` forces layout a thousand times a second, and invalidated on `resize`, on a
 *    capture-phase `scroll`, and from a `ResizeObserver` on the element.
 * 2. **Not setting `touch-action: none`.** The browser claims the pan, `pointermove` simply
 *    stops arriving mid-gesture, and iOS double-tap-zooms the whole game. Set inline, reverted
 *    on dispose, and diagnosed if the computed style disagrees anyway — a stylesheet rule with
 *    `!important` beats an inline style and nothing reports it.
 * 3. **Not capturing the pointer.** A drag that leaves the element, or passes *under* a `ui`
 *    panel, stops receiving moves and the camera halts with the finger still down. To a player
 *    that is the game freezing. Capture on `pointerdown`; every way of losing the pointer maps
 *    onto a `cancel`; the recogniser is never left latched.
 * 4. **Trusting `WheelEvent.deltaY`.** Three delta modes, and Firefox reports *lines* where
 *    Chrome reports pixels — the same flick zooms 30× less without the conversion. A trackpad
 *    pinch is a `wheel` with `ctrlKey` set. And the listener must be `{ passive: false }`, or
 *    the `preventDefault` that stops the page zooming is ignored.
 * 5. **Stuck keys.** `keydown` without its `keyup` happens on every alt-tab, and on macOS
 *    whenever a command chord is held. `blur` and `visibilitychange` release everything.
 * 6. **Two live instances driving one canvas.** Vite HMR leaves the previous module's listeners
 *    bound; without the throw below the symptom is a camera that pans twice as fast and a game
 *    that is impossible to debug.
 */

import type { Disposer } from '@lattice/core';
import { createSystem, internalsOf } from './system.js';
import type { HeadlessInputOptions, InputSystem } from './system.js';
import type { PointerKind } from './profile.js';

/** Options for {@link createInput}: the headless ones, plus the things only a browser has. */
export interface InputOptions<A extends string> extends HeadlessInputOptions<A> {
  /**
   * The world surface. Usually the canvas.
   *
   * Binding it twice without disposing the first **throws** — Vite HMR happily leaves two live
   * game instances driving one canvas, and the second one's camera fights the first's.
   */
  readonly element: HTMLElement;

  /**
   * Keep the browser context menu over the world. Default `false`.
   *
   * A long press on Android raises it mid-gesture, and it lands on top of the building the
   * player has just lifted. A game that wants a right-click menu of its own sets this and binds
   * `contextmenu` itself.
   */
  readonly keepContextMenu?: boolean;
}

/** An {@link InputSystem} bound to an element, which is the only thing a DOM one adds. */
export interface DomInputSystem<A extends string = never> extends InputSystem<A> {
  /** The bound surface. Its rect is what every `sx`/`sy` in the package is relative to. */
  readonly element: HTMLElement;
}

/**
 * Elements with a live binding, so a second one can be refused by name.
 *
 * A `WeakSet` rather than a counter: an element that is garbage collected takes its entry with
 * it, so a page that creates and drops surfaces does not leak one bit per surface.
 */
const BOUND = new WeakSet<HTMLElement>();

/**
 * The three inline styles a world surface needs.
 *
 * | property | value | without it |
 * |---|---|---|
 * | `touch-action` | `none` | the browser claims the pan and `pointermove` stops arriving mid-gesture |
 * | `overscroll-behavior` | `contain` | a downward drag near the top of an iOS page reloads the game |
 * | `user-select` | `none` | a drag selects the page |
 */
const REQUIRED_STYLE: readonly (readonly [string, string])[] = [
  ['touch-action', 'none'],
  ['overscroll-behavior', 'contain'],
  ['user-select', 'none'],
];

/**
 * Bind a world surface. Touches `document` and `window`, through the element rather than
 * through the globals, so a canvas inside an iframe binds to *its* document and not the top
 * one.
 *
 * Also set on the element and reverted on dispose: `touch-action: none`,
 * `overscroll-behavior: contain` and `user-select: none`. See this module's header for what
 * each of them prevents.
 *
 * @throws TypeError if `element` is not an element with `addEventListener`.
 * @throws RangeError if `element` already has a live binding — see {@link InputOptions.element}.
 * @throws RangeError / TypeError for everything `createHeadlessInput` refuses: a bad `stepMs`,
 *   an out-of-range threshold, a malformed action binding.
 */
export function createInput<A extends string = never>(
  options: InputOptions<A>,
): DomInputSystem<A> {
  const element = options.element;
  if (
    element === null ||
    typeof element !== 'object' ||
    typeof element.addEventListener !== 'function'
  ) {
    throw new TypeError(
      `createInput.element: expected the element the world is drawn on, got ${String(element)}`,
    );
  }
  if (BOUND.has(element)) {
    throw new RangeError(
      'createInput.element: this element already has a live input binding. Two systems on one canvas pan the camera twice as fast and make the game impossible to debug — dispose the first one (module hot-reload is the usual cause)',
    );
  }

  const system = createSystem<A>(options, 'createInput');
  // The system's own sink, so every diagnostic in the package obeys the same once-per-code rule
  // whether it came from here or from the recogniser.
  const { diagnose } = internalsOf(system);
  BOUND.add(element);

  const doc = element.ownerDocument;
  const view: (Window & typeof globalThis) | null = doc.defaultView;
  const style = element.style;

  // ── styles, remembered so dispose can put them back exactly ──────────────────────────────
  //
  // Property and previous value travel together rather than in two arrays with a shared index:
  // the pair cannot fall out of step, and teardown does not need a bounds check to prove it.
  const restore: { readonly property: string; readonly before: string }[] = [];
  for (const [property, value] of REQUIRED_STYLE) {
    restore.push({ property, before: style.getPropertyValue(property) });
    style.setProperty(property, value);
  }

  const computed = view === null ? undefined : view.getComputedStyle(element);
  if (computed !== undefined) {
    if (computed.getPropertyValue('touch-action') !== 'none') {
      diagnose({
        code: 'touch-action-overridden',
        message: `createInput: touch-action on this element computes to '${computed.getPropertyValue('touch-action')}' even though an inline 'none' was set — a stylesheet rule with !important beats an inline style. The browser will claim the pan and pointermove will stop arriving mid-gesture.`,
        element,
      });
    }
    if (computed.getPropertyValue('pointer-events') === 'none') {
      diagnose({
        code: 'pointer-events-none',
        message:
          'createInput: pointer-events on this element computes to none, so it will never receive a pointerdown and no gesture will ever be recognised.',
        element,
      });
    }
  }

  // ── the element rect, cached ─────────────────────────────────────────────────────────────
  let rectLeft = 0;
  let rectTop = 0;
  let rectValid = false;

  function refreshRect(): void {
    const rect = element.getBoundingClientRect();
    rectLeft = rect.left;
    rectTop = rect.top;
    rectValid = true;
  }
  function invalidateRect(): void {
    rectValid = false;
  }
  /** Read the rect at most once per event, and only when something has invalidated it. */
  function ensureRect(): void {
    if (!rectValid) refreshRect();
  }
  function localX(clientX: number): number {
    return clientX - rectLeft;
  }
  function localY(clientY: number): number {
    return clientY - rectTop;
  }

  // ── reused sample objects. `submit` copies, so one of each is enough for ever ────────────
  const downSample = { kind: 'down' as const, id: 0, sx: 0, sy: 0, pointerType: 'mouse' as PointerKind };
  const moveSample = { kind: 'move' as const, id: 0, sx: 0, sy: 0 };
  const upSample = { kind: 'up' as const, id: 0, sx: 0, sy: 0 };
  const cancelSample = { kind: 'cancel' as const, id: 0 };
  const wheelSample = { kind: 'wheel' as const, sx: 0, sy: 0, dz: 0, pinch: false };
  const keySample = { kind: 'key' as const, code: '', down: false };
  const blurSample = { kind: 'blur' as const };

  /** Pointer ids this binding has captured, so dispose can release every one of them. */
  const captured = new Set<number>();

  function pointerKind(type: string): PointerKind {
    if (type === 'touch') return 'touch';
    if (type === 'pen') return 'pen';
    // Anything else — including the empty string some older browsers report — is a mouse. A
    // wrong guess here costs 5 px of tap slop; refusing the event costs the whole gesture.
    return 'mouse';
  }

  function onPointerDown(event: PointerEvent): void {
    // Capture immediately, so every subsequent event for this pointer retargets here whatever
    // it passes over. A drag under a `ui` panel keeps its moves; a gesture that starts on the
    // world ends on the world; and a drag that ends over a button does not press it, which is
    // the behaviour you want because the gesture belonged to the world from the moment it
    // started. A press that starts *on* the overlay never reaches this listener at all.
    try {
      element.setPointerCapture(event.pointerId);
      captured.add(event.pointerId);
    } catch {
      // A pointer that has already gone away throws here. It is not an error: the terminal
      // sample for it is on its way, and the recogniser's exit does not depend on capture.
    }
    ensureRect();
    downSample.id = event.pointerId;
    downSample.sx = localX(event.clientX);
    downSample.sy = localY(event.clientY);
    downSample.pointerType = pointerKind(event.pointerType);
    system.submit(downSample);
  }

  function onPointerMove(event: PointerEvent): void {
    ensureRect();
    moveSample.id = event.pointerId;
    // A 120 Hz pointer delivers several positions per displayed frame. For panning the newest
    // is enough and cheaper; for anything drawing a stroke the coalesced list is the difference
    // between a smooth line and a polygon. Keep them all — the buffer's collapse rule is what
    // decides, under stall, that precision is the thing to spend.
    const coalesce = event.getCoalescedEvents;
    if (typeof coalesce === 'function') {
      const points = coalesce.call(event);
      for (const point of points) {
        moveSample.sx = localX(point.clientX);
        moveSample.sy = localY(point.clientY);
        system.submit(moveSample);
      }
      if (points.length > 0) return;
    }
    moveSample.sx = localX(event.clientX);
    moveSample.sy = localY(event.clientY);
    system.submit(moveSample);
  }

  function release(pointerId: number): void {
    if (!captured.delete(pointerId)) return;
    try {
      element.releasePointerCapture(pointerId);
    } catch {
      // Already released by the browser, which does it implicitly on up and cancel. Releasing
      // defensively and swallowing the throw is cheaper than tracking whose turn it was.
    }
  }

  function onPointerUp(event: PointerEvent): void {
    ensureRect();
    release(event.pointerId);
    upSample.id = event.pointerId;
    upSample.sx = localX(event.clientX);
    upSample.sy = localY(event.clientY);
    system.submit(upSample);
  }

  function onPointerCancel(event: PointerEvent): void {
    release(event.pointerId);
    cancelSample.id = event.pointerId;
    system.submit(cancelSample);
  }

  function onLostCapture(event: PointerEvent): void {
    // The capture went somewhere else — an alert, a native scroll, another element claiming it.
    // Without this the recogniser would sit in a dragging state for ever, and the first symptom
    // is a camera the player cannot stop.
    if (!captured.delete(event.pointerId)) return;
    cancelSample.id = event.pointerId;
    system.submit(cancelSample);
  }

  function onWheel(event: WheelEvent): void {
    // `{ passive: false }` is what makes this call legal; without it the browser ignores it and
    // ctrl+wheel zooms the whole page instead of the map.
    event.preventDefault();
    ensureRect();
    const profile = system.profile;
    const perUnit =
      event.deltaMode === 1 ? profile.wheelLinePx : event.deltaMode === 2 ? profile.wheelPagePx : 1;
    wheelSample.sx = localX(event.clientX);
    wheelSample.sy = localY(event.clientY);
    wheelSample.dz = event.deltaY * perUnit;
    // A trackpad pinch arrives as a wheel with ctrlKey set and much smaller deltas. Miss it and
    // pinch-to-zoom on a laptop scrolls instead of zooming.
    wheelSample.pinch = event.ctrlKey;
    system.submit(wheelSample);
  }

  /** A field is the browser's to type into: no key aimed at one becomes an action. */
  function isTextTarget(target: EventTarget | null): boolean {
    if (target === null) return false;
    const node = target as HTMLElement;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return node.isContentEditable === true;
  }

  function onKeyDown(event: KeyboardEvent): void {
    // In the source game the missing version of the first rule meant pasting a code containing
    // the letter *b* opened the shop mid-paste; the missing version of the second would mean
    // command-R no longer reloads. No binding in this package can ask for a modifier, so a key
    // carrying one is never ours.
    if (event.repeat || isTextTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    keySample.code = event.code;
    keySample.down = true;
    system.submit(keySample);
  }

  function onKeyUp(event: KeyboardEvent): void {
    // No modifier guard on the release: a key pressed plainly and released while command is
    // held would otherwise stay down for ever, which is the stuck-key bug wearing a disguise.
    if (isTextTarget(event.target)) return;
    keySample.code = event.code;
    keySample.down = false;
    system.submit(keySample);
  }

  function onBlur(): void {
    system.submit(blurSample);
  }

  function onVisibility(): void {
    if (doc.visibilityState === 'hidden') system.submit(blurSample);
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  /**
   * A transparent element covering the world eats every tap and nothing anywhere reports it.
   *
   * `#ui > * { pointer-events: auto }` out-specifies a bare `.spacer { pointer-events: none }`,
   * so an invisible spacer over the canvas swallows the game. This notices a `pointerdown`
   * whose client point lies inside the bound element's rect but whose target is neither the
   * element nor a descendant, and says so **once**, naming the culprit. A diagnostic rather
   * than a throw because a legitimate modal is also a cover, and on the first pointerdown
   * rather than at bind time for the same reason.
   */
  function onDocumentDown(event: PointerEvent): void {
    const target = event.target;
    if (target === element) return;
    if (target !== null && element.contains(target as Node)) return;
    const rect = element.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      return;
    }
    diagnose({
      code: 'covered-by-overlay',
      message:
        'createInput: a pointerdown inside the world element was delivered to something on top of it, so that press never reached the game. If this element is not a modal, it is covering the world — check for a spacer that inherits pointer-events: auto from a parent rule.',
      element: target === null ? element : (target as Element),
    });
  }

  // ── binding, all of it owned by the system's scope ───────────────────────────────────────
  const listeners: Disposer[] = [
    listen(element, 'pointerdown', onPointerDown),
    listen(element, 'pointermove', onPointerMove),
    listen(element, 'pointerup', onPointerUp),
    listen(element, 'pointercancel', onPointerCancel),
    listen(element, 'lostpointercapture', onLostCapture),
    listen(element, 'wheel', onWheel, { passive: false }),
    listen(element, 'contextmenu', onContextMenu, undefined, options.keepContextMenu !== true),
    listen(doc, 'keydown', onKeyDown),
    listen(doc, 'keyup', onKeyUp),
    listen(doc, 'visibilitychange', onVisibility),
    listen(doc, 'scroll', invalidateRect, { capture: true, passive: true }),
    listen(doc, 'pointerdown', onDocumentDown, { capture: true }),
    listen(view, 'blur', onBlur),
    listen(view, 'resize', invalidateRect),
  ];

  const observer = observeSize(view, element, invalidateRect);

  system.own((): void => {
    for (const off of listeners) off();
    observer();
    for (const id of [...captured]) release(id);
    for (const { property, before } of restore) {
      if (before === '') style.removeProperty(property);
      else style.setProperty(property, before);
    }
    BOUND.delete(element);
  });

  // The element is added to the system rather than wrapped around it. A wrapper would be a
  // second object with the same methods and a *different identity*, and `record(system)` looks
  // its internals up by identity — so a wrapped system would refuse to record, which is a
  // strange thing to discover an hour into a debugging session.
  Object.defineProperty(system, 'element', { value: element, enumerable: true });
  return system as DomInputSystem<A>;
}

/** Nothing, for the places a disposer is required and there is nothing to undo. */
function noop(): void {
  return;
}

/**
 * `addEventListener` plus its removal, as one value.
 *
 * `when` exists so an optional binding is still a disposer: the alternative is a nullable entry
 * in the listener list and a null check in teardown, which is where a leak hides.
 */
function listen(
  target: EventTarget | null,
  type: string,
  handler: (event: never) => void,
  options?: AddEventListenerOptions,
  when = true,
): Disposer {
  if (target === null || !when) return noop;
  const listener = handler as EventListener;
  target.addEventListener(type, listener, options);
  let live = true;
  return (): void => {
    if (!live) return;
    live = false;
    target.removeEventListener(type, listener, options);
  };
}

/**
 * Watch the element's own size, so a canvas that resizes without the window does not leave
 * every coordinate offset by the difference.
 *
 * Returns a disposer, and a no-op where `ResizeObserver` does not exist — the `resize` and
 * capture-phase `scroll` listeners still cover the common cases, and refusing to bind at all
 * because one API is missing would be a strange trade.
 */
function observeSize(
  view: (Window & typeof globalThis) | null,
  element: HTMLElement,
  onChange: () => void,
): Disposer {
  if (view === null) return noop;
  const Observer = view.ResizeObserver;
  if (typeof Observer !== 'function') return noop;
  const observer = new Observer(onChange);
  observer.observe(element);
  return (): void => {
    observer.disconnect();
  };
}
