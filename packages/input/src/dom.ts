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
 *    onto a `cancel`; the recognizer is never left latched.
 * 4. **Trusting `WheelEvent.deltaY`.** Three delta modes, and Firefox reports *lines* where
 *    Chrome reports pixels — the same flick zooms 30× less without the conversion. A trackpad
 *    pinch is a `wheel` with `ctrlKey` set. And the listener must be `{ passive: false }`, or
 *    the `preventDefault` that stops the page zooming is ignored.
 * 5. **Stuck keys.** `keydown` without its `keyup` happens on every alt-tab, and on macOS
 *    whenever a command chord is held. `blur` and `visibilitychange` release everything.
 * 6. **Two live instances driving one canvas.** Vite HMR leaves the previous module's listeners
 *    bound; without the throw below the symptom is a camera that pans twice as fast and a game
 *    that is impossible to debug.
 * 7. **An invisible element covering the world.** It eats every tap and nothing anywhere reports
 *    it. Reported once, and only for a node that never declared itself — see
 *    `declaredChrome` for how a legitimate HUD is told apart from a spacer without this file
 *    learning anything about what is in the world.
 */

import type { Disposer } from '@latticekit/core';
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

  /**
   * Roots whose subtrees are chrome, not a cover. For the `covered-by-overlay` diagnostic, and
   * for nothing else.
   *
   * **Most games need this and do not know it, because most chrome already declares itself.**
   * The diagnostic's real test is whether *anything* between the pressed node and the document
   * root sets `pointer-events` inline — see {@link createInput}. `@latticekit/ui` does, on every
   * node it grants, so a `ui` panel is silent here with no configuration at all. This option is
   * for the HUD that is styled entirely from a stylesheet and therefore cannot be told apart
   * from the spacer the diagnostic exists to catch.
   *
   * Read at the moment a cover is found rather than captured at construction, so a HUD built
   * after the input still counts and an array a game pushes into keeps working.
   *
   * **This is not a hit-test and cannot become one.** It carries no rectangle, no ordering and
   * nothing about the world; the only question it can answer is "did the game already know
   * something was there", which is a question about the page, not about the game. Passing the
   * world element itself would be meaningless — a press on the world never reaches this check.
   */
  readonly overlays?: readonly Element[];
}

/**
 * The one member of an element `declaredChrome` reads.
 *
 * Written out rather than imported because `Element` does not declare `style` and the elements
 * that do — `HTMLElement`, `SVGElement`, `MathMLElement` — have no common ancestor that does.
 * Optional on purpose: a document can in principle hold an element with no inline style at all,
 * and a missing one is simply "declared nothing".
 */
interface MaybeStyled {
  readonly style?: { getPropertyValue(name: string): string };
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
 * A press that lands on something *over* the world is reported once as `covered-by-overlay`,
 * unless something between that node and the document root declared `pointer-events` inline or
 * the node is inside an {@link InputOptions.overlays} root. Every `@latticekit/ui` panel satisfies
 * the first without being configured.
 *
 * @throws TypeError if `element` is not an element with `addEventListener`.
 * @throws RangeError if `element` already has a live binding — see {@link InputOptions.element}.
 * @throws RangeError / TypeError for everything `createHeadlessInput` refuses: a `step` that is
 *   not the loop's, an out-of-range threshold, a malformed action binding.
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
  // whether it came from here or from the recognizer.
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
          'createInput: pointer-events on this element computes to none, so it will never receive a pointerdown and no gesture will ever be recognized.',
        element,
      });
    }
  }

  // ── the element rect, cached ─────────────────────────────────────────────────────────────
  let rectLeft = 0;
  let rectTop = 0;
  // Kept as well as the origin so the overlay check below can ask "was that press inside the
  // world" without forcing a layout on every pointerdown anywhere on the page — including every
  // press on the HUD, which is the one this check is most often asked about.
  let rectRight = 0;
  let rectBottom = 0;
  let rectValid = false;

  function refreshRect(): void {
    const rect = element.getBoundingClientRect();
    rectLeft = rect.left;
    rectTop = rect.top;
    rectRight = rect.right;
    rectBottom = rect.bottom;
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
    // the behavior you want because the gesture belonged to the world from the moment it
    // started. A press that starts *on* the overlay never reaches this listener at all.
    try {
      element.setPointerCapture(event.pointerId);
      captured.add(event.pointerId);
    } catch {
      // A pointer that has already gone away throws here. It is not an error: the terminal
      // sample for it is on its way, and the recognizer's exit does not depend on capture.
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
    // Without this the recognizer would sit in a dragging state for ever, and the first symptom
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
   * Did somebody *declare* that this node takes pointer events, or did a stylesheet hand it one?
   *
   * This is the whole of {@link onDocumentDown}'s judgement, and it is worth stating why it is
   * the right question. The diagnostic below cannot ask whether a node is visible, and it must
   * never ask what is in the world — that is this package's central refusal. What it can ask is
   * whether the node's `pointer-events: auto` was **written on the element**:
   *
   * | how a node came to take the press | inline `pointer-events` | verdict |
   * |---|---|---|
   * | `@latticekit/ui`'s `interactive(node)`, or a hand-written `style="pointer-events:auto"` | `auto` on it or an ancestor | chrome — somebody named this node |
   * | listed in {@link InputOptions.overlays} | — | chrome — the game said so |
   * | a spacer that lost `.spacer { pointer-events: none }` to `#ui > * { pointer-events: auto }` | `none` on an ancestor, nothing below | **the trap** |
   * | a bare `<div>` over the canvas with no declaration anywhere | none | reported, and correctly: nothing on the page ever said this should eat a tap |
   *
   * `@latticekit/ui` makes this free rather than lucky. It ships **no stylesheet at all** and writes
   * `pointer-events` inline per node — `auto` on the ones it grants, `none` on the rest — so
   * every `ui` panel over a canvas is recognized here with no configuration, and the one
   * configuration that used to be needed (filtering the diagnostic on a class name, which is
   * exactly the workaround a kit exists to remove) is gone.
   *
   * The walk stops at the **first** element carrying an inline declaration, because that is the
   * one that decided: an inline `none` with a stylesheet `auto` below it is the trap, spelled
   * out. Any inline value other than `none` counts as a grant — `visiblePainted` and friends are
   * SVG's way of saying the same thing.
   */
  function declaredChrome(target: Element): boolean {
    // Read here rather than captured at construction: a HUD built after the input still counts.
    const declared = options.overlays;
    if (declared !== undefined) {
      for (const root of declared) {
        if (root === target || root.contains(target)) return true;
      }
    }
    for (let node: Element | null = target; node !== null; node = node.parentElement) {
      // `Element` does not declare `style`; every element that can carry one — HTML, SVG, MathML
      // — does. A structural read rather than an `instanceof HTMLElement`, because the global is
      // one this package's tests deliberately do not provide.
      const inline = (node as MaybeStyled).style?.getPropertyValue('pointer-events') ?? '';
      if (inline === '') continue;
      return inline !== 'none';
    }
    return false;
  }

  /**
   * A transparent element covering the world eats every tap and nothing anywhere reports it.
   *
   * `#ui > * { pointer-events: auto }` out-specifies a bare `.spacer { pointer-events: none }`,
   * so an invisible spacer over the canvas swallows the game. This notices a `pointerdown` whose
   * client point lies inside the bound element's rect, whose target is neither the element nor a
   * descendant, and which {@link declaredChrome} does not recognize — and says so **once**,
   * naming the culprit.
   *
   * A diagnostic rather than a throw because a cover can be legitimate, and on the first
   * pointerdown rather than at bind time because a HUD is usually built after the input is.
   *
   * The rect is the cached one. The uncached version forced a layout on every pointerdown
   * anywhere in the document, for the life of the game, including every press on the HUD.
   */
  function onDocumentDown(event: PointerEvent): void {
    const target = event.target;
    if (target === element) return;
    if (target !== null && element.contains(target as Node)) return;
    ensureRect();
    if (
      event.clientX < rectLeft ||
      event.clientX > rectRight ||
      event.clientY < rectTop ||
      event.clientY > rectBottom
    ) {
      return;
    }
    if (target !== null && declaredChrome(target as Element)) return;
    diagnose({
      code: 'covered-by-overlay',
      message:
        'createInput: a pointerdown inside the world element was delivered to something on top of it, so that press never reached the game — and nothing between that node and the document root declares pointer-events inline, so whatever made it take the press came from a stylesheet. That is how an invisible spacer swallows the world: a bare `.spacer { pointer-events: none }` loses to a rule like `#ui > * { pointer-events: auto }`. If this node is chrome, say so — @latticekit/ui already does it for you (mount(node, { interactive: true }) writes the grant inline), or list its root in createInput({ overlays: [hud] }).',
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
  // No idempotence guard. Every one of these is called exactly once, from the single teardown
  // registered on the system's scope, and `removeEventListener` is idempotent in the platform
  // anyway — so a `live` flag here would be a branch no test could ever take, which is worse
  // than no branch at all.
  return (): void => {
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
