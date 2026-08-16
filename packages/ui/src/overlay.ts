/**
 * The root, the pointer contract, and the two cadences — the three things that make the rest of
 * this package small.
 *
 * ## The pointer contract, stated once
 *
 * > The overlay root is `pointer-events: none`, set **inline**. Interactivity is granted to
 * > *nodes*, never by selector. This package ships **no stylesheet at all**, and in particular
 * > no rule of the form `#ui > *`, so there is nothing for a game's
 * > `.spacer { pointer-events: none }` to lose a specificity fight against. If a tap should
 * > reach the world, do nothing. If it should not, name the node.
 *
 * That is a rule rather than a warning because the failing configuration no longer exists.
 * There is no descendant rule to out-specify, and an inline `auto` on a full-width wrapper is
 * something a person had to type.
 *
 * ## The overlay owns no clock
 *
 * `driver: 'driven'` is the default and the default is the point: no timer, no
 * `requestAnimationFrame` loop, nothing advances until `tick()` or `repaint()` is called. In a
 * game that means `@lattice/loop`'s `update` and `render`, which is what {@link drive} wires.
 *
 * The failure this designs out is not a crash. It is a HUD that *appears* to work: one cadence
 * from the loop and one of its own, drifting apart, until a poll lands between the player's
 * confirm and the settle that clears the condition — at which point a one-shot dialog reopens
 * blank and the obvious recovery overwrites what they typed. A second clock is how a game
 * acquires a poll it did not know it had written.
 */

import { createScope, expectFinite, type Disposer, type Scope } from '@lattice/core';
import { createCadence, type CadenceFn } from './cadence.js';
import { el, interactive, passthrough } from './el.js';
import { hostComputedStyle, hostDocument, hostFrameLoop, hostInterval } from './host.js';

/**
 * Undo a mount, a subscription or a widget.
 *
 * The kit's teardown vocabulary is `Disposer` from `@lattice/core` and this is that type, not a
 * second one: `Scope.add` has to accept what `ui.every` returns without a cast, and two
 * identical aliases would be two things to keep in step. The name `Dispose` is kept because the
 * RFC spells it that way and consumers were written against it; prefer `Disposer` in new code.
 */
export type Dispose = Disposer;

/**
 * The four layers, bottom to top.
 *
 * Fixed, named and small on purpose. A z-index a game can pick is a z-index two games will pick
 * differently, and then a toast lands under a scrim — which is not a message that was shown
 * badly, it is a message that was not shown.
 */
export type LayerName = 'floats' | 'panels' | 'modal' | 'toasts';

/** Bottom to top. The array order **is** the stacking order; the z-index values below are
 *  derived from it so the two can never disagree. */
const LAYER_ORDER: readonly LayerName[] = ['floats', 'panels', 'modal', 'toasts'];

/** Default interval for `driver: 'standalone'`. One second: the standalone driver exists for
 *  menus and component pages, where the fastest thing on screen is a countdown. */
const DEFAULT_STANDALONE_MS = 1000;

/** How an overlay is created. */
export interface OverlayOptions {
  /**
   * Time, injected — and it must be **the same clock `@lattice/loop` was given**.
   *
   * The kit bans `Date.now()` inside every `src/`, and a widget that reads a clock it was not
   * handed is a widget no test can fast-forward. Most of this package's time arrives as the
   * argument to `tick()`; `now` covers the moments that originate outside a tick — a toast
   * spawned in a click handler, the `visibilitychange` resync, the standalone driver — and two
   * clocks in one HUD is the same class of bug as two cadences.
   */
  readonly now: () => number;
  /** Where the root is appended. Defaults to `document.body`. */
  readonly parent?: HTMLElement;
  /**
   * Who advances the state cadence. Default `'driven'`.
   *
   * - `'driven'` — the overlay starts **no timer and no `requestAnimationFrame` loop**. It
   *   advances only when something calls `tick()` / `repaint()`.
   * - `'standalone'` — the overlay runs its own interval at `standaloneMs` and its own frame
   *   loop. For a HUD with no game behind it: a menu, a settings screen, a component page. In
   *   this mode `tick()` throws, because a host calling it *as well* is precisely the
   *   two-clocks bug this option exists to keep out of games.
   */
  readonly driver?: 'driven' | 'standalone';
  /** Only with `driver: 'standalone'`. Default 1000.
   *  @throws RangeError if set in `'driven'` mode, which would be a cadence nobody reads. */
  readonly standaloneMs?: number;
  /** Stacking against your canvas. Default `1`, which is right when the canvas has none. */
  readonly zIndex?: number;
}

/** How one node joins the overlay. */
export interface MountOptions {
  /** Default `'panels'`. */
  readonly layer?: LayerName;
  /**
   * Opt this subtree into pointer events. Default `false`, and that default is the package's
   * most important one: a tap that is not on a node you named reaches the world.
   */
  readonly interactive?: boolean;
}

/** A modal holding the top of the stack. Registered by `panel`; the Escape key and the scrim
 *  are handled here so that "the top one only" is decided in one place. */
export interface ModalEntry {
  /** Whether Escape and the scrim may close it. An `acknowledge` sets `false`. */
  readonly dismissible: boolean;
  /** Close it, exactly as its own close button would. */
  close(): void;
}

/** Anything the overlay must invalidate when the brand hue changes. `ThumbCache` is the only
 *  implementer, and the indirection is what keeps `theme` from importing `thumb`. */
export interface Invalidatable {
  /** Drop everything cached. */
  invalidate(): void;
}

/**
 * The parts of an overlay its own widgets use and a game does not.
 *
 * Exported from this module and **not from `index.ts`**: `panel`, `toast`, `roll`, `thumb` and
 * `theme` all need the document, the clock and the modal stack, and the alternative to one
 * internal seam is five public ones that a game would then be free to hold wrongly.
 */
export interface OverlayInternals {
  /** The document the root lives in. Widgets build into this, never into a global. */
  readonly doc: Document;
  /** The overlay's injected clock, for work that starts outside a tick. */
  readonly now: () => number;
  /** Teardown tree. Every widget registers its own `destroy` here, which is what makes
   *  `ui.destroy()` a complete teardown rather than a list somebody has to maintain. */
  readonly scope: Scope;
  /** Custom properties already written on the root, so `applyPalette` can skip the unchanged
   *  ones without reading style back out of the DOM. */
  readonly vars: Map<string, string>;
  /** Thumbnail caches bound to this overlay, invalidated together by `setBrand`. */
  readonly caches: Set<Invalidatable>;
  /** The modal stack, bottom to top. `modalOpen` is `length > 0`. */
  readonly modals: ModalEntry[];
  /** Which driver this overlay was created with. `drive` refuses a standalone one. */
  readonly driver: 'driven' | 'standalone';
  /** The container for a layer. */
  layerNode(name: LayerName): HTMLElement;
  /**
   * Register work for the return from a hidden tab: snap, do not animate.
   *
   * Runs before the state cadence, so a roll lands on its target and then the tick that follows
   * sees a settled widget. A player returning to a tab after an hour must not watch four
   * seconds of counting up to a number the HUD already knew.
   */
  onResync(fn: () => void): Disposer;
  /** False once `destroy()` has run. Widgets check it before touching a detached tree. */
  alive(): boolean;
}

/** The overlay: a root, four layers, two cadences and a teardown. */
export interface Overlay {
  /** The overlay root. Pointer-transparent, `position: fixed; inset: 0`, and never transformed. */
  readonly root: HTMLElement;
  /** True while any modal panel is open. Hosts use it to park world-space controls. */
  readonly modalOpen: boolean;

  /** The container for a layer, if you need to style or measure it. Do not reparent it. */
  layer(name: LayerName): HTMLElement;

  /**
   * Put a node in a layer. Returns the node, so it composes inside an `el()` call.
   *
   * Writes `pointer-events` inline on the node either way — `auto` when `interactive`, `none`
   * otherwise. The `none` is not redundant with the layer's: a game stylesheet containing
   * `.lattice-layer > * { pointer-events: auto }` targets *this* node, not the layer, and
   * without an inline declaration of its own the node would win that rule and swallow every tap
   * on the world behind it. Inline beats any author rule that is not `!important`, so the
   * guarantee holds against a sheet this package never sees.
   *
   * @throws Error if the overlay has been destroyed — a node mounted into a detached root is a
   * widget that runs, ticks and is never seen.
   */
  mount<T extends HTMLElement>(node: T, opts?: MountOptions): T;

  /**
   * Register work on the **state cadence** — everything `tick()` runs, and therefore
   * `@lattice/loop`'s `update`, which advances on wall time whether or not anything paints.
   *
   * Anything whose absence would make the HUD *wrong* goes here: prices, affordability,
   * disabled buttons, build timers, toast expiry, the day/night palette.
   *
   * Note what this is **not**: a `setInterval` of this package's own. `update` already is the
   * interval, and a HUD polling beside the simulation instead of with it is a poll racing a
   * settle — which silently replaced a player's typed company name in the game this kit came
   * from.
   */
  every(fn: CadenceFn): Disposer;

  /**
   * Register work on the **paint cadence** — everything `repaint()` runs, and therefore
   * `@lattice/loop`'s `render`: rAF, 0 Hz in a hidden tab, throttled on a low-power device,
   * skipped entirely under load.
   *
   * Anything registered here must be *cosmetic*: **if it never runs once, every number on
   * screen must still be right.** That is the whole rule.
   */
  paint(fn: CadenceFn): Disposer;

  /**
   * Advance the state cadence. Call this from your loop's `update` and nowhere else.
   *
   * `nowMs` defaults to the overlay's own clock, which is what {@link drive} uses. Pass it
   * explicitly only when you are the clock's owner.
   *
   * **Do not write `loop.onUpdate(ui.tick)` against `@lattice/loop`.** Its update callback is
   * `(dt, tick)` in *seconds*, so the overlay would be told the time is 0.016 ms, forever. It is
   * bound, so the reference is safe to pass around; it is the argument that is wrong. Use
   * `drive(ui, loop)`.
   *
   * A no-op after `destroy()`, so a loop still holding the reference during a hot reload does
   * not throw sixty times a second on the way out.
   *
   * @throws Error, naming the mistake, if the overlay was created with `driver: 'standalone'`.
   * @throws RangeError if `nowMs` is given and is not finite.
   */
  tick(nowMs?: number): void;
  /** Advance the paint cadence. Call this from your loop's `render`. Bound, like `tick`. */
  repaint(nowMs?: number): void;

  /** Remove the root, cancel anything the standalone driver started, drop every listener this
   *  package added, and destroy every widget bound to this overlay. Idempotent. */
  destroy(): void;
}

/** Overlay → its internals. A `WeakMap` rather than a hidden property so that nothing a game
 *  can enumerate, spread or `JSON.stringify` carries the modal stack around with it. */
const INTERNALS = new WeakMap<Overlay, OverlayInternals>();

/**
 * The internals of an overlay this package created.
 *
 * @throws TypeError if `ui` did not come from {@link createOverlay} — which is the honest
 * failure for a hand-rolled object that satisfies `Overlay` structurally but has no layers, no
 * clock and no scope behind it.
 */
export function internalsOf(ui: Overlay): OverlayInternals {
  const found = INTERNALS.get(ui);
  if (found === undefined) {
    throw new TypeError(
      'this overlay did not come from createOverlay() — widgets need its document, clock and modal stack, and a structurally-similar object has none of them',
    );
  }
  return found;
}

/**
 * Build an overlay: a pointer-transparent root, four layers, and two cadences that nothing
 * advances until you do.
 *
 * @throws TypeError if `now` is not a function — the one option with no sensible default,
 * because a clock this package chose for itself would be the second clock in the game.
 * @throws RangeError if `driver` is not one of the two names, if `standaloneMs` is set outside
 * standalone mode, or if `standaloneMs` / `zIndex` is not finite.
 */
export function createOverlay(opts: OverlayOptions): Overlay {
  if (typeof opts !== 'object' || opts === null) {
    throw new TypeError(`createOverlay: expected an options object, got ${typeof opts}`);
  }
  const now = opts.now;
  if (typeof now !== 'function') {
    throw new TypeError(
      `createOverlay: \`now\` must be a function returning milliseconds, got ${typeof now} — pass the same clock @lattice/loop was given`,
    );
  }
  const driver = opts.driver ?? 'driven';
  if (driver !== 'driven' && driver !== 'standalone') {
    throw new RangeError(
      `createOverlay: \`driver\` must be 'driven' or 'standalone', got ${JSON.stringify(driver)}`,
    );
  }
  if (opts.standaloneMs !== undefined && driver !== 'standalone') {
    throw new RangeError(
      "createOverlay: `standaloneMs` is only read with driver: 'standalone' — in 'driven' mode it would be a cadence nobody reads, and a cadence nobody reads is a cadence somebody will later wire up",
    );
  }
  const standaloneMs =
    opts.standaloneMs === undefined
      ? DEFAULT_STANDALONE_MS
      : expectFinite(opts.standaloneMs, 'createOverlay: standaloneMs');
  if (standaloneMs <= 0) {
    throw new RangeError(
      `createOverlay: \`standaloneMs\` must be greater than 0, got ${String(standaloneMs)}`,
    );
  }
  const zIndex = opts.zIndex === undefined ? 1 : expectFinite(opts.zIndex, 'createOverlay: zIndex');

  const doc = opts.parent === undefined ? hostDocument() : opts.parent.ownerDocument;
  const parent = opts.parent ?? doc.body;
  if (parent === null || typeof parent.appendChild !== 'function') {
    throw new TypeError(
      'createOverlay: no `parent` and this document has no body yet — build the overlay after the document is ready, or pass `parent`',
    );
  }

  const scope = createScope();
  const state = createCadence('ui.every');
  const paints = createCadence('ui.paint');
  const resyncs = createCadence('ui.resync');
  const vars = new Map<string, string>();
  const caches = new Set<Invalidatable>();
  const modals: ModalEntry[] = [];
  let alive = true;

  const root = el('div', { class: 'lattice-ui' });
  // Every one of these is structural. `position: fixed; inset: 0` rather than `100vh`: on iOS
  // Safari `100vh` is the viewport with the URL bar *collapsed*, so the bottom of the overlay
  // sits under the browser chrome until the player scrolls — which a game with
  // `overscroll-behavior: none` never does.
  root.style.setProperty('position', 'fixed');
  root.style.setProperty('inset', '0');
  root.style.setProperty('z-index', String(zIndex));
  root.style.setProperty('pointer-events', 'none');

  const layers = new Map<LayerName, HTMLElement>();
  let depth = 0;
  for (const name of LAYER_ORDER) {
    depth += 1;
    const node = el('div', { class: `lattice-layer lattice-layer-${name}` });
    node.style.setProperty('position', 'absolute');
    node.style.setProperty('inset', '0');
    // The stack is DOM order *and* an explicit z-index. Either alone would hold; together they
    // also stop a game's own `z-index: 999` inside a panel from climbing out of its layer,
    // because each layer is its own stacking context.
    node.style.setProperty('z-index', String(depth));
    node.style.setProperty('pointer-events', 'none');
    layers.set(name, node);
    root.appendChild(node);
  }

  parent.appendChild(root);
  scope.add(() => {
    root.parentNode?.removeChild(root);
  });

  function layerNode(name: LayerName): HTMLElement {
    const node = layers.get(name);
    if (node === undefined) {
      throw new RangeError(
        `overlay.layer: unknown layer ${JSON.stringify(name)} — the four are ${LAYER_ORDER.join(', ')}`,
      );
    }
    return node;
  }

  /** The state cadence, reachable from inside regardless of driver. `tick()` is the public door
   *  and it is closed in standalone mode; this is the door the driver and the resync use. */
  function runState(nowMs: number): void {
    if (!alive) return;
    state.run(nowMs);
  }

  function runPaint(nowMs: number): void {
    if (!alive) return;
    paints.run(nowMs);
  }

  /**
   * Come back from hidden: snap, then advance.
   *
   * Both halves matter. Background throttling is not only about rAF — a tab hidden long enough
   * has its timers clamped too, so `update` on a wall clock catches up in one large step and an
   * animation started from that step would run for its full duration in front of a player who
   * has already seen the answer. Snapping first makes the catch-up invisible.
   */
  function resync(): void {
    const nowMs = now();
    resyncs.run(nowMs);
    runState(nowMs);
  }

  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') resync();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  scope.add(() => {
    doc.removeEventListener('visibilitychange', onVisibility);
  });

  // One Escape listener for the whole overlay rather than one per panel: "the top one only" is
  // a property of the stack, and a per-panel listener has to ask the stack anyway — after which
  // four open panels are four listeners racing to answer the same key.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    const top = modals[modals.length - 1];
    if (top === undefined || !top.dismissible) return;
    top.close();
  };
  doc.addEventListener('keydown', onKeyDown);
  scope.add(() => {
    doc.removeEventListener('keydown', onKeyDown);
  });

  const ui: Overlay = {
    root,

    get modalOpen(): boolean {
      return modals.length > 0;
    },

    layer(name: LayerName): HTMLElement {
      return layerNode(name);
    },

    mount<T extends HTMLElement>(node: T, mountOpts?: MountOptions): T {
      if (!alive) {
        throw new Error(
          'overlay.mount: this overlay has been destroyed — the node would be attached to a detached root and never seen',
        );
      }
      layerNode(mountOpts?.layer ?? 'panels').appendChild(node);
      if (mountOpts?.interactive === true) interactive(node);
      else passthrough(node);
      return node;
    },

    every(fn: CadenceFn): Disposer {
      return scope.add(state.add(fn));
    },

    paint(fn: CadenceFn): Disposer {
      return scope.add(paints.add(fn));
    },

    // Arrow properties, not methods: `ui.tick` is passed as a value by `drive` and by any host
    // wiring its own loop, and an unbound method reference here is a `TypeError` on the first
    // tick — when the loop is already running and the stack no longer names this file.
    tick: (nowMs?: number): void => {
      if (driver === 'standalone') {
        throw new Error(
          "overlay.tick: this overlay was created with driver: 'standalone' and advances itself — a host calling tick() as well is two clocks in one HUD, which is the bug the option exists to keep out. Create it with the default driver: 'driven' and drive it from your loop's update.",
        );
      }
      runState(nowMs ?? now());
    },

    repaint: (nowMs?: number): void => {
      runPaint(nowMs ?? now());
    },

    destroy(): void {
      if (!alive) return;
      alive = false;
      modals.length = 0;
      scope.dispose();
    },
  };

  INTERNALS.set(ui, {
    doc,
    now,
    scope,
    vars,
    caches,
    modals,
    driver,
    layerNode,
    onResync: (fn: () => void): Disposer => scope.add(resyncs.add(() => {
      fn();
    })),
    alive: () => alive,
  });

  if (driver === 'standalone') {
    scope.add(
      hostInterval(() => {
        runState(now());
      }, standaloneMs),
    );
    scope.add(
      hostFrameLoop(() => {
        runPaint(now());
      }),
    );
  }

  return ui;
}

/**
 * The shape of a game loop, as this package needs it.
 *
 * Declared structurally rather than imported: `ui` is layer 3 and depends on `core` and `draw`
 * only, so it cannot name `@lattice/loop` — but it can describe it, and the real `Loop`
 * satisfies this without knowing that `ui` exists.
 *
 * **Both callbacks are declared as taking no arguments, and that is deliberate.**
 * `@lattice/loop` hands `update` a *delta in seconds* and `render` an interpolation alpha;
 * neither is the wall-clock reading this overlay wants, and a `Driven` that promised one would
 * be a promise the real loop does not keep. The overlay reads its own injected clock instead —
 * the same clock the loop was given.
 */
export interface Driven {
  /** Subscribe to the state cadence. Must return a disposer that unsubscribes. */
  onUpdate(fn: () => void): Disposer;
  /** Subscribe to the paint cadence. Must return a disposer that unsubscribes. */
  onRender(fn: () => void): Disposer;
}

/**
 * Wire an overlay to a loop: `update` drives `tick`, `render` drives `repaint`.
 *
 * One export for two lines a caller could write, and it earns its place because those two lines
 * are the ones it is fatal to cross. `render`-drives-`tick` is a HUD that freezes with stale
 * prices and stale disabled states the moment the tab goes behind another — the bug the source
 * game shipped and then fixed with a comment. Here it is not a comment; it is a function whose
 * whole body is the correct pairing.
 *
 * Returns a disposer that unwires both. Disposing it is not the same as destroying the overlay —
 * a paused game may want the HUD detached from the loop and still on screen — but the reverse
 * does hold: `ui.destroy()` unwires the loop, so a torn-down overlay cannot be left subscribed to
 * a running one.
 *
 * @throws TypeError if `loop` has no `onUpdate`/`onRender` — which is what a loop that takes its
 * callbacks at construction looks like from here, and the fix is two lines of hand-wiring rather
 * than a shim.
 * @throws Error if the overlay is `driver: 'standalone'`, at wiring time rather than on the
 * first update, so the two-clocks mistake fails at the line that made it.
 */
export function drive(ui: Overlay, loop: Driven): Disposer {
  if (
    typeof loop !== 'object' ||
    loop === null ||
    typeof loop.onUpdate !== 'function' ||
    typeof loop.onRender !== 'function'
  ) {
    throw new TypeError(
      'drive: expected a loop with onUpdate(fn) and onRender(fn), each returning a disposer — if yours takes its callbacks at construction, call ui.tick() from update and ui.repaint() from render by hand',
    );
  }
  if (internalsOf(ui).driver === 'standalone') {
    throw new Error(
      "drive: this overlay was created with driver: 'standalone' and already advances itself — driving it from a loop as well is two clocks in one HUD. Create it with the default driver: 'driven'.",
    );
  }
  const stopUpdate = loop.onUpdate(() => {
    ui.tick();
  });
  const stopRender = loop.onRender(() => {
    ui.repaint();
  });
  let stopped = false;
  const unwire = (): void => {
    if (stopped) return;
    stopped = true;
    stopUpdate();
    stopRender();
  };
  // Registered on the overlay's scope as well as returned. A destroyed overlay that stayed
  // subscribed would leave two closures on a live loop, called sixty times a second, holding the
  // whole torn-down HUD alive — which under Vite's hot reload is a second one every save.
  const release = internalsOf(ui).scope.add(unwire);
  return () => {
    release();
    unwire();
  };
}

/** Styles that re-parent every `position: fixed` descendant to the element carrying them. Trap
 *  10, and invisible until someone adds a slide-in animation to the root. */
const CONTAINING_BLOCK_PROPS: readonly string[] = ['transform', 'filter', 'will-change'];

/** `div.lattice-layer.lattice-layer-toasts`, for an error message a reader can act on. */
function describe(node: Element): string {
  const classes = node.className === '' ? '' : `.${node.className.trim().split(/\s+/).join('.')}`;
  return `${node.tagName.toLowerCase()}${classes}`;
}

/** The inline `pointer-events` of a node, or `''`. Inline is the package's own grant; anything
 *  else that computes to `auto` came from a stylesheet, which is the thing being audited. */
function inlinePointerEvents(node: HTMLElement): string {
  return node.style.getPropertyValue('pointer-events');
}

/**
 * Dev-time audit. One English sentence per problem found, empty when clean.
 *
 * It catches the two failures that are invisible until a player reports "I can't tap the ground
 * here":
 *
 * 1. **A node whose computed `pointer-events` is `auto` that this package never granted it.**
 *    That can only have come from a stylesheet, which means a game has written the descendant
 *    rule this package refuses to ship, and a full-width wrapper is now swallowing every tap on
 *    the world behind it.
 * 2. **A `transform`, `filter` or `will-change` on the root or a layer**, which silently
 *    re-parents every `position: fixed` descendant to that element — a modal scrim that no
 *    longer covers the viewport, a toast column anchored to the wrong thing.
 *
 * Call it from a test, or from the console when a tap goes missing. It reads computed styles,
 * so it costs a layout: it is a diagnostic, not something to run per frame.
 *
 * Returns an empty array where the host cannot compute styles at all — a report of "no problems"
 * from a host that cannot see any would be worse than no report, so the sentences say which
 * check produced them.
 */
export function auditOverlay(ui: Overlay): readonly string[] {
  const internals = internalsOf(ui);
  const problems: string[] = [];

  const structural: Element[] = [ui.root, ...LAYER_ORDER.map((name) => internals.layerNode(name))];
  for (const node of structural) {
    const computed = hostComputedStyle(node);
    if (computed === undefined) continue;
    for (const prop of CONTAINING_BLOCK_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value !== '' && value !== 'none' && value !== 'auto') {
        problems.push(
          `${describe(node)} has ${prop}: ${value} — that makes it the containing block for every position:fixed descendant, so the modal scrim no longer covers the viewport and the toast column is anchored to the wrong thing. Animate a child, never the root or a layer.`,
        );
      }
    }
  }

  /** Walk the subtree, stopping at each node this package granted: everything below an
   *  interactive node computes to `auto` legitimately, by inheritance. */
  function walk(node: HTMLElement): void {
    const computed = hostComputedStyle(node);
    if (computed !== undefined) {
      const value = computed.getPropertyValue('pointer-events');
      if (value === 'auto' && inlinePointerEvents(node) !== 'auto') {
        problems.push(
          `${describe(node)} computes to pointer-events: auto but was never passed to interactive() — a stylesheet granted it, and an invisible wrapper that swallows taps on the world is the failure this package's inline-only rule exists to prevent.`,
        );
        return;
      }
      if (value === 'auto') return;
    }
    // Everything under an overlay root is an element with a style, including a game's own SVG
    // icons; `children` is typed as `Element` because a document can in principle hold others.
    for (const child of node.children) walk(child as HTMLElement);
  }
  walk(ui.root);

  return problems;
}
