# RFC — `@lattice/ui`

| | |
|---|---|
| **status** | proposed — no implementation yet |
| **layer** | 3 (the top; nothing imports this) |
| **depends on** | `@lattice/core`, `@lattice/draw` |
| **environment** | browser. Every module in this package touches `document`. |
| **modules** | `overlay`, `el`, `panel`, `toast`, `roll`, `thumb`, `theme` |
| **budget** | 12 kB gzipped, and it should come in near half of that |

---

## 1. The one sentence

**`@lattice/ui` is the handful of DOM primitives a game HUD cannot avoid needing — a
pointer-transparent overlay, an element builder, panels, toasts, number rolls, floating
feedback and canvas thumbnails — and it is deliberately not a framework, because the whole
overlay is a few dozen nodes that change a few times a second and a virtual DOM would be
more code than the UI it manages.**

The measure of this package is `../foom-simple-ui/src/ui/hud.ts`: **3,102 lines**, 342 calls
to `el()`, 59 `classList` pokes, 37 `this.lastX` fields whose only job is "do not write the
DOM if the string did not change", and seven hand-rolled `setTimeout` chains. None of that is
game logic. It is the same six patterns written out longhand, over and over, because there
was nothing underneath. If a HUD of that size cannot be written in ~300 lines against this
package, this package failed.

---

## 2. The five-line example

The thing a game does 90% of the time: put a number on the screen, keep it right, and say
something when an event happens.

```ts
import { fmt } from '@lattice/core';
import { createOverlay, drive, el, roll } from '@lattice/ui';

const ui = createOverlay({ now: () => Date.now() });
const gold = roll(ui, { format: fmt });
ui.mount(el('div', { class: 'hud' }, 'Gold ', gold.node), { interactive: true });
ui.every((nowMs) => gold.set(wallet.goldAt(nowMs)));
drive(ui, loop); // `update` drives ui.tick, `render` drives ui.repaint. Never the other way round.
```

And when something happens: `toasts(ui).show('Refinery online', 'good')`.

Five lines, and five of the package's hard decisions are already made for the caller:

- **The overlay is pointer-transparent** and `{ interactive: true }` is the only thing that
  ever makes a node tappable. A tap that is not on a node you named reaches the world.
- **This package owns no clock.** `ui.every` runs on `@lattice/loop`'s **`update`** callback,
  which advances on wall time whether or not anything paints. The overlay starts no timer of
  its own, because a second cadence beside the loop's is a poll racing a settle (§6, trap 4).
- **There is no way to put a state update in `render`.** The only other cadence is called
  `paint`, and its contract is that nothing breaks if it never runs.
- **The roll animates itself** on the paint cadence and snaps on `visibilitychange`, so a tab
  that comes back from an hour in the background shows the right number instantly rather
  than counting up from an hour ago.
- **Formatting comes from `@lattice/core`.** This package has no `fmt`, and never will.

---

## 3. The public surface

### 3.0 An argument with the brief

`.lattice/kit.json` lists the modules as `el`, `panel`, `toast`, `roll`, `thumb`. That list is
missing the two things that carry the package's whole point, and I am asking the orchestrator
to update it (I own only this file):

| change | why |
|---|---|
| **add `overlay`** | The pointer-event contract, the two cadences and the layer stack are the package's reason to exist. Leaving them implicit means every widget re-invents them, which is precisely how `hud.ts` reached 3,102 lines. |
| **add `theme`** | Recolouring the whole HUD from one brand hue is one function and three custom properties. Without it, every game writes `document.documentElement.style.setProperty('--brand', …)` by hand and the thumbnail cache goes stale behind it (§6, trap 7). |
| **keep floating numbers inside `roll`** | `+120` rising off a building and a wallet ticking up to 1,240 are the same feature seen twice: a number in screen space, animated, that must be correct without animation. One module, two exports. |
| **reword this package's third invariant** | It currently reads *"anything that is not painting updates on an interval, not inside the frame loop."* Right in spirit, wrong in letter. `@lattice/loop`'s `update` **already is** the interval; a `ui` that reads that sentence literally starts a `setInterval` of its own and now the HUD polls on one clock while the simulation settles on another — which is `PLAYBOOK.md` trap 12, the bug that overwrote a player's typed company name. It must read: **"anything that is not painting updates on the loop's `update` callback, never inside `render`."** The two sentences sound identical and are not. |

Seven modules, nineteen exported functions. Everything else in this section is a type.

### 3.1 What this package needs from its dependencies

This is the complete list of symbols `@lattice/ui` imports. If a name here does not survive
its own package's RFC, this one needs a note, not a workaround.

```ts
// @lattice/core
import type { Rng } from '@lattice/core';        // only in doc comments: thumbnails must be seeded
import { easeOutCubic } from '@lattice/core';    // the roll's curve

// @lattice/draw
import type { Surface } from '@lattice/draw';
import { createCanvasSurface } from '@lattice/draw'; // an offscreen Surface over a <canvas>
import { hueToHex } from '@lattice/draw';           // one hue -> one CSS colour
```

`@lattice/core`'s `fmt` / `fmtRate` / `fmtDuration` are **not** imported. Formatting is the
caller's choice, passed in as `RollOptions.format`, so a game can ship its own suffix ladder
without forking this package.

**`@lattice/loop` is not imported either, and that is a layering fact rather than a
preference** — `ui` is layer 3 and depends on `core` and `draw` only. But the HUD's cadence
*is* the loop's `update`, so this package meets it structurally: `Driven` in §3.2 is the shape
of a loop, declared here, satisfied by the real one without an import. A game with no loop at
all — a menu, a settings screen, a storybook page — calls `tick()` itself and the overlay does
not notice the difference.

### 3.2 `overlay` — the root, the pointer contract, the two cadences

```ts
/** Undo a mount, a subscription, or a widget. Every function that attaches something returns one. */
export type Dispose = () => void;

/**
 * The four layers, bottom to top. Fixed, named and small on purpose: a z-index that a game
 * can pick is a z-index two games will pick differently, and then a toast lands under a scrim.
 */
export type LayerName = 'floats' | 'panels' | 'modal' | 'toasts';

export interface OverlayOptions {
  /**
   * Time, injected — and it must be **the same clock `@lattice/loop` was given**.
   *
   * The kit bans `Date.now()` inside `src/`, and a widget that reads a clock it was not handed
   * is a widget no test can fast-forward. Almost all of this package's time arrives as the
   * argument to `tick()`; `now` covers the moments that originate outside a tick — a toast
   * spawned in a click handler, the `visibilitychange` resync — and it is the only clock the
   * standalone driver has. Two clocks in one HUD is the same class of bug as two cadences.
   */
  readonly now: () => number;
  /** Where the root is appended. Defaults to `document.body`. */
  readonly parent?: HTMLElement;
  /**
   * Who advances the state cadence. Default `'driven'`, and the default is the point.
   *
   * - `'driven'` — the overlay starts **no timer and no `requestAnimationFrame` loop**. It
   *   advances only when something calls `tick()` / `repaint()`, which in a game means
   *   `@lattice/loop`'s `update` and `render` (see `drive` below). One clock, the loop's.
   * - `'standalone'` — the overlay runs its own `setInterval` at `standaloneMs` and its own
   *   rAF loop. This is for a HUD with no game behind it: a menu, a settings screen, a
   *   component page. In this mode `tick()` throws, because a host calling it *as well* is
   *   precisely the two-clocks bug this option exists to keep out of games.
   */
  readonly driver?: 'driven' | 'standalone';
  /** Only with `driver: 'standalone'`. Default 1000. @throws RangeError if set in `'driven'` mode, which would be a cadence nobody reads. */
  readonly standaloneMs?: number;
  /** Stacking against your canvas. Default `1`, which is right when the canvas has none. */
  readonly zIndex?: number;
}

export interface MountOptions {
  /** Default `'panels'`. */
  readonly layer?: LayerName;
  /**
   * Opt this subtree into pointer events. Default `false`, and that default is the package's
   * single most important one — see §6, trap 1.
   */
  readonly interactive?: boolean;
}

export interface Overlay {
  /** The overlay root. Pointer-transparent, `position: fixed; inset: 0`, and never transformed. */
  readonly root: HTMLElement;
  /** True while any modal panel is open. Hosts use it to park world-space controls and hold one-shot UI. */
  readonly modalOpen: boolean;

  /** The container for a layer, if you need to style or measure it. Do not reparent it. */
  layer(name: LayerName): HTMLElement;

  /** Put a node in a layer. Returns the node, so it composes inside an `el()` call. */
  mount<T extends HTMLElement>(node: T, opts?: MountOptions): T;

  /**
   * Register work on the **state cadence**: an interval, so it keeps running when
   * `requestAnimationFrame` is throttled to zero in a backgrounded tab. Anything whose absence
   * would be a *wrong* HUD — prices, affordability, disabled buttons, timers — goes here.
   */
  every(fn: (nowMs: number) => void): Dispose;

  /**
   * Register work on the **paint cadence**: `requestAnimationFrame`, and therefore 0 Hz in a
   * hidden tab, throttled on a low-power device and skipped entirely under load. Anything
   * registered here must be *cosmetic*: if it never runs once, every number on screen must
   * still be right. That is the whole rule, and §5, invariant 2 tests it.
   */
  paint(fn: (nowMs: number) => void): Dispose;

  /** Run the state cadence once, now. Idempotent: writes are change-guarded, so calling it from your frame loop as well is free. */
  tick(nowMs: number): void;
  /** Run the paint cadence once, now. */
  repaint(nowMs: number): void;

  /** Remove the root, cancel the interval and the rAF loop, drop every listener this package added. */
  destroy(): void;
}

export function createOverlay(opts: OverlayOptions): Overlay;

/**
 * Dev-time audit. Returns one English sentence per problem found, empty when clean.
 *
 * It catches the two failures that are invisible until a player reports "I can't tap the
 * ground here": a node whose computed `pointer-events` is `auto` that was never passed to
 * `interactive()`, and a `transform` / `filter` / `will-change` on the root or a layer, which
 * silently re-parents every `position: fixed` descendant. Call it from a test, or from the
 * console when a tap goes missing.
 */
export function auditOverlay(ui: Overlay): readonly string[];
```

**The pointer-event contract, stated as a rule:**

> The overlay root is `pointer-events: none`, set inline. Interactivity is granted to
> **nodes**, never by selector: `interactive(node)` writes `pointer-events: auto` inline on
> exactly the node it is given, and `pointer-events` inherits from there to its children.
> This package ships **no stylesheet at all**, and in particular no rule of the form
> `#ui > *`, so there is nothing for a game's `.spacer { pointer-events: none }` to lose a
> specificity fight against. If a tap should reach the world, do nothing. If it should not,
> name the node.

That is the fix for the trap that cost the source game real time (`PLAYBOOK.md` trap 1). It
is a rule rather than a comment because the failing configuration no longer exists: there is
no descendant rule to out-specify, and an inline `auto` on a wrapper is a thing somebody had
to type.

### 3.3 `el` — the element builder and the four write helpers

```ts
export type Attrs = Readonly<Record<string, string | number | boolean | EventListener | undefined>>;
export type Child = Node | string | false | null | undefined;

/**
 * Build an element.
 *
 * `class` and `text` are special-cased, keys starting with `on` bind listeners, `undefined`
 * and `false` values are skipped, `true` sets a bare attribute, and falsy children are
 * dropped so `cond && el(...)` reads inline.
 *
 * There is deliberately **no `html` key.** The source game had one, and the first string a
 * game wants to interpolate is the player's own typed company name. An element builder that
 * makes `innerHTML` the short path is a cross-site-scripting hole with good ergonomics.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K];

/** Empty a node. `innerHTML = ''` leaks listeners on some engines; this does not. */
export function clear(node: Element): void;

/**
 * Write text only if it changed, and say whether it did.
 *
 * This one function replaces the 37 `private lastX = ''` fields in the source game's HUD.
 * The return value is the point: `if (setText(n, s)) pulse(n)` is how you flash a change
 * without flashing every tick.
 */
export function setText(node: Node, text: string): boolean;

/**
 * Show or hide, inline, so it wins.
 *
 * `hidden` is a user-agent rule of specificity zero, and `display: flex` in a game's own
 * stylesheet beats it — the source game hit this and had to restate `[hidden] { display: none }`
 * on every flex element that could hide. An inline `display: none` cannot lose. The `hidden`
 * attribute is set too, for assistive technology and for `:not([hidden])` selectors.
 */
export function show(node: HTMLElement, on?: boolean): void;
export function hide(node: HTMLElement): void;

/**
 * Restart a CSS animation on a node — the "+1" bump on a resource pill.
 *
 * Removing and re-adding a class in the same task does nothing; the browser never sees the
 * intermediate state. The forced reflow between the two is **load-bearing**, and is the exact
 * line a tidying pass deletes as a no-op, after which the second collect in a row does not
 * bump and nobody can say why.
 */
export function pulse(node: HTMLElement, className?: string): void;

/** Grant pointer events to this node and its subtree, inline. The only way in. */
export function interactive<T extends HTMLElement>(node: T): T;
/** Take them away again — for a decorative child of an interactive panel, e.g. a full-width header glow. */
export function passthrough<T extends HTMLElement>(node: T): T;
```

### 3.4 `panel` — sheets, modals, and the latch

```ts
export interface PanelOptions {
  /** A modal gets a scrim, traps focus, sets `role="dialog"` and blocks the world. Default `false`. */
  readonly modal?: boolean;
  /** Scrim click and Escape close it. Default `true`. A confirmation that must be answered sets `false`. */
  readonly dismissible?: boolean;
  /** Default `'panels'`, or `'modal'` when `modal` is true. */
  readonly layer?: LayerName;
  /** Called after close, whatever closed it — button, scrim, Escape, or `destroy()`. */
  readonly onClose?: () => void;
}

export interface Panel {
  /** Your content goes in here. The package owns the wrapper, the scrim and the close affordance; you own everything inside. */
  readonly node: HTMLElement;
  readonly isOpen: boolean;

  open(): void;

  /**
   * Open at most once, ever, for the life of this panel — and return whether *this* call was
   * the one that opened it.
   *
   * This exists because of a data-loss bug, not for tidiness. The source game polled a derived
   * condition every 900 ms to decide whether to show its company namer, while the condition
   * only cleared on a 1000 ms settle. The namer therefore reopened *after* the player pressed
   * CONFIRM, blank; the obvious recovery — press CONFIRM again — overwrote the name they had
   * just typed with a random roll. **The recovery the bug invited was the bug's payload.**
   *
   * A latch makes the racing poll harmless: `ui.every(() => { if (questIsNaming) namer.openOnce(); })`
   * is correct at any poll rate, including one faster than the state that drives it.
   */
  openOnce(): boolean;

  close(): void;
  destroy(): void;
}

export function panel(ui: Overlay, opts?: PanelOptions): Panel;
```

Modals are a **stack**. Opening a second over the first pushes; Escape and the scrim pop the
top only; `ui.modalOpen` is true while the stack is non-empty. Focus moves into the top panel
on open and is restored to the previously focused element on close.

### 3.5 `toast` — the game talking to the player, briefly

```ts
export type ToastKind = 'plain' | 'good' | 'bad';

export interface ToastOptions {
  /** Never more than this many on screen; the oldest is dropped. Default 3 — a wall of toasts hides the game. */
  readonly max?: number;
  /**
   * Floor for how long one lives. Default 7000.
   *
   * The source game shipped 3200 and it was wrong: long enough for "+40 MW" and nowhere near
   * enough for a sentence, and the toasts carrying real information are exactly the long ones.
   */
  readonly minMs?: number;
  /** Added per character on top of `minMs`, at roughly a slow reading pace. Default 55. */
  readonly msPerChar?: number;
}

export interface ToastHost {
  /**
   * Show one. Holds while the pointer is over it — somebody reading a toast is the one person
   * who must not lose it — and a tap dismisses it early rather than making them wait it out.
   */
  show(text: string, kind?: ToastKind): void;
  clear(): void;
  destroy(): void;
}

export function toasts(ui: Overlay, opts?: ToastOptions): ToastHost;
```

Toasts live in the topmost layer, **above the scrim**. A message that lands under a modal has
not been shown, it has been lost, and holding it in a queue instead means the queue has to be
drained by somebody. Expiry runs on the state cadence, so a tab that was hidden for a minute
comes back with the backlog already gone rather than with forty toasts to dismiss.

### 3.6 `roll` — numbers that move, and numbers that fly

```ts
export interface RollOptions {
  /** Where it lives. Created as `<span class="lattice-roll">` if you do not pass one. */
  readonly node?: HTMLElement;
  /** Default `String`. Pass `fmt` from `@lattice/core` for compact magnitudes. */
  readonly format?: (value: number) => string;
  /** Roll duration. Default 400. Longer than about 600 and the number is unreadable while it moves. */
  readonly ms?: number;
  /** Pulsed on every settled change. Default `'bump'`. Pass `''` to disable. */
  readonly bumpClass?: string;
}

export interface Roll {
  readonly node: HTMLElement;
  /** The target — always the truth, even mid-roll. Read this in a test, never `node.textContent`. */
  readonly value: number;
  /** Set the target. Cheap and idempotent: setting the value it already has does nothing at all. */
  set(value: number): void;
  /** Land on the target immediately. Called for you on `visibilitychange` and by `snapAll`. */
  snap(): void;
  destroy(): void;
}

/**
 * A number that eases to its target on the paint cadence.
 *
 * The contract that makes it safe: **the roll is animation only.** `set()` records the target
 * and `value` reports it immediately; if the paint cadence never runs — hidden tab, low power,
 * a test — the next state tick writes the target text directly. A HUD is never wrong because a
 * frame did not happen; it is only less pretty.
 */
export function roll(ui: Overlay, opts?: RollOptions): Roll;

export type FloatKind = 'gain' | 'loss' | 'plain';

/** A mutable point, used only as an output parameter. Structurally a `Vec2` from `@lattice/core`. */
export interface ScreenPoint { x: number; y: number }

export interface FloatOptions {
  /**
   * How many can be alive at once. Default 24. The nodes are created up front and recycled;
   * `spawn()` allocates nothing, because a big collect spawns a dozen of these in one tap and
   * a garbage collection during the feedback for a tap is the tap feeling bad.
   */
  readonly capacity?: number;
  /** Lifetime. Default 900. */
  readonly ms?: number;
  /**
   * Re-project each live float's anchor, every paint.
   *
   * Omit it and `spawn()` takes screen pixels, which is right for a static camera. Supply it
   * and `spawn()` takes whatever coordinates you like — world units, grid units — and this
   * converts them, so a `+120` stays glued to the building it came from while the player is
   * still dragging the camera. `@lattice/ui` does not know what a camera is and must not;
   * three lines of `worldToScreen` from `@lattice/iso` live on the game's side of this hook.
   */
  readonly project?: (anchorX: number, anchorY: number, out: ScreenPoint) => void;
}

export interface FloatHost {
  /**
   * Spawn one. Four primitives, no object: this is the hot path in a collect-and-spend game.
   * Over capacity, the oldest float is recycled — the newest feedback is the one the player
   * is looking for.
   */
  spawn(anchorX: number, anchorY: number, text: string, kind?: FloatKind): void;
  destroy(): void;
}

/**
 * Floating "+120" feedback, in the overlay's bottom layer.
 *
 * It is DOM rather than canvas because it is screen-space type: it wants the game's font,
 * its text shadow and its colour tokens, and painting it through `@lattice/draw`'s text kit
 * would mean a second typographic system that drifts from the first. It is in the *bottom*
 * layer because feedback must never intercept the next tap, and the layer is
 * `pointer-events: none` with no way to turn that on.
 *
 * Motion is a Web Animations keyframe set by this package, not a CSS class you have to
 * supply — the kit ships zero assets and that includes stylesheets, so a float must move on
 * its own or the primitive is half a primitive. Style the rest with `.lattice-float`.
 */
export function floats(ui: Overlay, opts?: FloatOptions): FloatHost;
```

### 3.7 `thumb` — the one real bridge from `draw` to the DOM

```ts
export interface ThumbSpec {
  /** CSS pixels. The backing canvas is this times `dpr`. */
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio, clamped to [1, 2]. Default: the window's, clamped. A 3x phone otherwise pays 9x the fill for a shop card. */
  readonly dpr?: number;
  /** Painted before `paint` runs. Any CSS colour. Default: transparent. */
  readonly background?: string;
  /**
   * Draw the thumbnail. Same `Surface` the world is drawn with, already scaled for `dpr`, so
   * `width` and `height` are CSS pixels.
   *
   * This must be **deterministic**: same key, same pixels. If your sprite jitters, seed it
   * from an `Rng` you construct here, or hard-code the jitter — a card whose building leans a
   * different way on every reload is a card that makes the shop look broken.
   */
  readonly paint: (surface: Surface, width: number, height: number) => void;
}

export interface ThumbCache {
  /**
   * A `data:` URL for `<img src>`, painted once per key.
   *
   * The key must name **everything that changes the pixels** — the building id, its level,
   * and the size. It must *not* name the brand hue: `setBrand` invalidates every cache on the
   * overlay for you, which is the structural fix for the staleness bug in §6, trap 7.
   */
  url(key: string, spec: ThumbSpec): string;
  /** Drop everything. Called for you by `setBrand`. */
  invalidate(): void;
  readonly size: number;
  destroy(): void;
}

/**
 * A bounded thumbnail cache bound to an overlay.
 *
 * Bounded because a `data:` URL for a 240x140 card is tens of kilobytes of string, and the
 * source game's cache was an unbounded `Map` keyed by (building, brand, size) that a player
 * who liked changing their colour could grow without limit. Least-recently-used eviction at
 * `capacity`, default 64.
 */
export function thumbnails(ui: Overlay, capacity?: number): ThumbCache;
```

### 3.8 `theme` — one hue, one palette, no design system

```ts
export interface BrandOptions {
  /** HSL saturation for the derived colour, 0..1. Default 0.72. */
  readonly saturation?: number;
  /** HSL lightness for the derived colour, 0..1. Default 0.62. */
  readonly lightness?: number;
}

/**
 * Recolour the overlay from a single hue in degrees.
 *
 * Writes exactly three custom properties on the overlay root — `--lattice-brand`,
 * `--lattice-brand-hi`, `--lattice-brand-lo` — derived through `@lattice/draw`'s colour model,
 * so the HUD accent and the buildings in the world are the same hue *by construction* rather
 * than by two people picking hex codes. Your stylesheet consumes them; this package never
 * reads them back.
 *
 * On the root, not on `document.documentElement`, for two reasons: a global custom property is
 * a global variable, and two overlays on one page (a game and its own settings preview) must
 * be able to disagree. It also invalidates every `ThumbCache` on this overlay, because a
 * thumbnail painted in the old brand is now a lie.
 *
 * @throws RangeError if `hue` is not finite.
 */
export function setBrand(ui: Overlay, hue: number, opts?: BrandOptions): void;

/**
 * Set arbitrary custom properties on the overlay root.
 *
 * The escape hatch that stops this package growing a design system: a game that wants a
 * `--panel-radius` or a `--danger` sets it here and styles with it. `@lattice/ui` defines no
 * scale, no ramp and no palette beyond the brand triplet above.
 *
 * @throws RangeError naming the offending key if any key does not start with `--`.
 */
export function setTokens(ui: Overlay, tokens: Readonly<Record<string, string>>): void;

/**
 * A set of named colours. Whatever `@lattice/draw` produces from interpolating two palettes
 * by a 0..1 parameter is one of these: names to CSS colour strings, and nothing else.
 * `@lattice/ui` neither defines the names nor knows what they mean.
 */
export type Palette = Readonly<Record<string, string>>;

export interface PaletteOptions {
  /** Custom-property namespace. Default `'lattice'`, so a key `sky` becomes `--lattice-sky`. */
  readonly prefix?: string;
}

/**
 * Push a palette onto the overlay as custom properties, and say whether anything moved.
 *
 * This is `setBrand`'s mechanism driven by a different input. The brand hue is chosen once at
 * incorporation; a day/night palette is a fresh set of strings as dusk falls, and the overlay
 * has to darken with the world — a HUD glowing in its daytime colours over a night scene is
 * the most obvious way an overlay reveals itself as a separate layer bolted on top.
 *
 * **Write it on the state cadence, never the frame loop.** The whole palette is one object of
 * short strings; the cost is not building it, it is that a custom property written on the root
 * invalidates style for every node that inherits it — the entire overlay. At 60 Hz that is
 * sixty full-subtree style recalculations a second to animate something the eye reads over
 * three minutes, and it is the exact pattern trap 3 is about: put it in the frame loop and it
 * stops in a backgrounded tab, so the player returns to a night world under a noon HUD.
 *
 * ```ts
 * ui.every(() => applyPalette(ui, lerpPalette(DAY, NIGHT, world.dayT)));
 * ```
 *
 * Three properties make that correct rather than merely cheap:
 *
 * 1. **It is change-guarded per key.** An identical palette writes nothing and returns
 *    `false`, so pushing every tick — or from your frame loop, if you insist — is wasteful
 *    rather than wrong. Quantise `t` on your side (1/64 is plenty for a dusk) and the guard
 *    turns most pushes into no-ops for free.
 * 2. **Smoothing is a CSS transition, not a JavaScript tween.** One-second steps look like
 *    steps; `transition: background-color 1.2s linear` in *your* stylesheet turns them into a
 *    continuous fade that runs on the compositor, costs no main-thread work, needs no frame
 *    callback, and degrades to an instant jump in a hidden tab — which is the correct
 *    behaviour, because nobody is looking.
 * 3. **It does not invalidate thumbnails**, unlike `setBrand`. A shop card is a portrait of
 *    the building, not a photograph of it at this hour, and a cache rebuilt once a second is a
 *    memory leak with a pleasant API.
 *
 * @throws RangeError naming the offending key if any key is empty or contains a character
 *         that is not valid in a custom-property name.
 */
export function applyPalette(ui: Overlay, palette: Palette, opts?: PaletteOptions): boolean;
```

### 3.9 The class names are public API

The package ships no CSS, so the only thing a game's stylesheet can hold on to is the node
structure and these names. Renaming one is a breaking change.

| class | on |
|---|---|
| `lattice-ui` | the overlay root |
| `lattice-layer`, `lattice-layer-floats` / `-panels` / `-modal` / `-toasts` | the four layer containers |
| `lattice-panel`, `lattice-panel-modal` | a panel wrapper |
| `lattice-scrim` | the modal scrim |
| `lattice-toast`, `lattice-toast-plain` / `-good` / `-bad`, `lattice-toast-bar` | a toast and its life bar |
| `lattice-roll` | a roll's default node |
| `lattice-float`, `lattice-float-gain` / `-loss` / `-plain` | a floating number |

Two custom-property namespaces are written on the root and are equally public:
`--lattice-brand`, `--lattice-brand-hi`, `--lattice-brand-lo` from `setBrand`, and
`--lattice-<key>` for every key of a palette pushed through `applyPalette`. Your sheet reads
them; nothing in this package ever reads them back.

And the complete list of CSS properties this package ever writes to an element's inline style:
`position`, `inset`, `left`, `top`, `z-index`, `pointer-events`, `display`. Nothing decorative
— no colour, no font, no radius, no shadow. That list is testable (§5, invariant 7) and it is
the boundary between "primitives" and "a look you have to fight".

---

## 4. What is deliberately absent

This is the section that stops the next agent adding it back. `@lattice/ui` is the package
most likely to go wrong by growing: every one of the following has an obvious first version
that is fifteen lines and a mature version that is a framework.

| not here | why, and whose job it is |
|---|---|
| **A virtual DOM, reactivity, signals, or templates** | The whole overlay is a few dozen nodes changing a few times a second. Diffing is pure overhead against `setText`, which is already the change guard. The source game's HUD updates cost nothing measurable; the diffing to avoid them would. |
| **State binding** — `bind(state, node, selector)` | The moment this package can read your state it needs a shape for your state, and the shape wins. You call `set()` and `setText()` inside `ui.every()`. That is three characters more than a binding and it never surprises you about *when*. |
| **A component library** — buttons, tabs, sliders, dropdowns, progress bars, accordions | A button is `el('button', { class: 'btn', onclick })` plus your stylesheet, and every game wants a different one. Shipping a styled button means shipping a look, and a look is the one thing a zero-asset kit must let the game own. The three widgets that *are* here (panel, toast, float) earn it by owning **behaviour** — a focus trap, a hold-on-hover expiry, a recycling pool — not appearance. |
| **A layout engine** — grids, stacks, anchoring, breakpoints, safe-area insets | CSS is the layout engine and it is already in the browser. This package guarantees exactly one thing about geometry: the root fills the viewport and the four layers stack in a fixed order. Where your dock sits, and whether it clears the iPhone home indicator, is `env(safe-area-inset-bottom)` in your sheet. |
| **A stylesheet, a theme preset, or a dark mode** | Non-negotiable 8 is zero assets, and a CSS file is an asset. `setBrand` is a bridge from `@lattice/draw`'s colour model into three custom properties; that is the entire opinion this package holds about how anything looks. |
| **Input handling** — gestures, pointer normalisation, drag, long-press, keyboard maps | `@lattice/input` (layer 2). This package sets `pointer-events` and attaches `click`; if you find yourself computing a drag threshold in here, you are writing the wrong package. |
| **Colour interpolation, palette blending, contrast checking** | `@lattice/draw` owns the colour model, including interpolating two palettes by a `t` for day and night. `applyPalette` takes the *result* — a bag of name-to-CSS-string — so the overlay darkens with the world without this package learning what "dusk" is, or holding a second opinion about how a colour is derived. |
| **Tweening and easing curves** | `@lattice/loop` has tweens and `@lattice/core` has easing. The roll uses `easeOutCubic` from core; floats and toast bars use Web Animations, which is the platform's own tween and runs off the main thread. |
| **Number formatting, pluralisation, i18n** | `@lattice/core`'s `format` module. The source game put `fmt` in its DOM helpers and that is exactly the accretion this table exists to prevent: formatting is a pure function of a number and belongs where pure functions live. `RollOptions.format` is how it gets here. |
| **A camera, a projection, or world-space anchoring** | `@lattice/iso`. `FloatOptions.project` is a hook, not a dependency: three lines of `worldToScreen` on the game's side, and this package stays runnable with no world at all — which is what makes it usable on a menu screen. |
| **A screen/scene/route state machine** | The game's own `main.ts`. In the source game this was a `mode` machine, it was 200 lines, it was entirely about that game's verbs, and no two games would have agreed on it. |
| **Canvas rendering** | `@lattice/draw`. `thumb` is the single bridge and it does not draw anything: it hands you a `Surface` and turns what you painted into a `data:` URL. |
| **Tooltips, context menus, drag-and-drop, virtualised lists** | Nobody's job yet. Each is a real package's worth of edge cases (positioning against a viewport edge, touch equivalence, a11y), and none of them is load-bearing for an isometric idle game. If the demo game needs one, it writes it, and *then* we look at whether it generalised. |

---

## 5. The invariants

Phrased so a failing case is obvious. Each is a test a reviewer can write before reading the
implementation.

1. **A tap that is not on a node you named reaches the world.** Mount a full-screen spacer
   without `interactive`, put a `click` listener on an element behind the overlay, dispatch a
   click at the centre of the viewport: the listener fires. Add a game stylesheet containing
   `.lattice-layer > * { pointer-events: auto }` and the test must *still* pass, because the
   package's own `none` is inline and inline wins.
2. **The HUD is correct with the paint cadence never running.** Construct with
   `autoStart: false`, call `tick()` only, never `repaint()`, and every readout — roll text,
   panel disabled states, toast expiry — reaches its final value. A roll left frozen mid-count
   is a failure. This is the executable form of "a backgrounded tab must not freeze the HUD
   into stale prices".
3. **Coming back from hidden is instant and correct.** Dispatch `visibilitychange` to visible:
   every roll snaps to its target within the same task, and expired toasts are gone before the
   next frame — not counted up from an hour ago and not dismissed one at a time.
4. **`openOnce` opens at most once**, across any number of calls, including calls made while
   the panel is open, after it has been closed, and interleaved with `open()`. The property to
   test is a loop of 1,000 `openOnce()` calls producing exactly one `true`.
5. **`spawn` allocates nothing after warm-up.** Spawn `capacity` floats, then spawn 1,000 more:
   the layer's child count never exceeds `capacity`, and no new element is created. Measurable
   with a `MutationObserver` counting `addedNodes`.
6. **Everything is disposable.** After `ui.destroy()`, `document.body` contains no node this
   package created, `setInterval`/`rAF` handles are cancelled, and no listener remains on
   `window` or `document`. A game that hot-reloads twice must not accumulate two overlays —
   the source game had two live instances driving one canvas and could not tell.
7. **The package writes only structural CSS.** Grep the built output for `.style.` assignments
   and `setProperty`: the property set is exactly `position`, `inset`, `left`, `top`, `z-index`,
   `pointer-events`, `display`, plus custom properties written by
   `setTokens`/`setBrand`/`applyPalette`. A `color` or a `font-family` in that list means the
   package started having opinions.

8. **Pushing an unchanged palette costs one string comparison per key and no DOM write.**
   `applyPalette(ui, p)` twice with the same object returns `true` then `false`, and a spy on
   `root.style.setProperty` records writes only for keys whose value actually differs. The
   failing case is a dusk that reflows the HUD sixty times a second and a profile that blames
   the game.
9. **`setText` writes only on change.** Spy on the text node: setting the same string twice
   performs one write and returns `false` the second time.
10. **`hide` beats a stylesheet.** With `.thing { display: flex !important }` in the document,
   `hide(node)` still results in a zero-size box. (Inline `!important` is the fallback if the
   plain inline value loses; the test is written against the observable, not the mechanism.)
11. **Thumbnails are keyed and bounded, and a palette push does not disturb them.** The same
    key twice paints once and returns an identical string; `setBrand` makes the next call paint
    again; a thousand `applyPalette` calls make it paint *zero* more times; adding
    `capacity + 1` distinct keys leaves `capacity` entries.
12. **No banned clocks.** `npm run lint` finds no `Date.now`, `performance.now` or
    `Math.random` in `src/`. Time enters through `OverlayOptions.now` and nowhere else — the
    `requestAnimationFrame` timestamp argument is deliberately *ignored*, because two clocks
    in one widget is how a roll ends up ahead of the toast that announced it.

---

## 6. The traps

What a naive implementation gets wrong. Numbers in brackets are traps from
`../foom-simple-ui/PLAYBOOK.md`, which are traps because they already cost that game time.

1. **`#ui > *` out-specifies a bare class, and swallows the world** *(trap 1)*. The natural
   design is "root is `none`, children are `auto`, one rule each". Then a flex spacer stretched
   across the middle of the screen inherits `auto` from the `> *` rule, its own
   `.spacer { pointer-events: none }` loses the specificity fight, and every tap on the ground
   dies on an invisible div. Nothing on screen changes; the game simply stops responding in the
   middle. **The implementation must not contain a descendant selector at all** — per-node
   inline `auto`, and `auditOverlay` to catch a game that adds one.

2. **`display: flex` beats `[hidden]`** *(trap 2)*. The user-agent `[hidden] { display: none }`
   rule has specificity zero. Any element the game styles as flex and then hides with the
   attribute stays visible. `hide()` writes the inline `display` for this reason; setting only
   the attribute is the naive version and it is wrong for exactly the elements a HUD hides.

3. **`requestAnimationFrame` is 0 Hz in a background tab** *(traps 3, 9)*. The canvas keeps
   showing its last painted frame so the game *looks* alive, and a HUD updated inside the frame
   loop freezes with it: stale prices, stale disabled buttons, a build timer that stopped. The
   source game's fix was one `setInterval(…, 1000)` running everything that is not painting,
   and this package makes that the default by having no frame-loop registration for state at
   all. Two further points a naive interval gets wrong: browsers clamp background intervals
   hard (Chrome to roughly one per minute after five minutes), so the overlay must **also**
   resync on `visibilitychange` rather than trusting the interval alone; and the resync must
   *snap* animations rather than starting them, or the player returns to a tab that spends four
   seconds counting up.

4. **A poll racing a settle is data loss, not a flicker** *(trap 12)*. Covered by `openOnce`
   above, and it deserves repeating in the implementation's own comments: the failure mode is
   not a modal that blinks. It is a modal that reappears *blank* after a confirm, invites the
   player to press confirm again, and overwrites what they typed. Any one-shot UI driven off a
   poll of derived state has this bug latent in it.

5. **Restarting a CSS animation needs a forced reflow.** `classList.remove('bump')` then
   `classList.add('bump')` in the same task does nothing at all — the browser never observes
   the removal. `void node.offsetWidth` between them is the whole mechanism, it looks like dead
   code, and deleting it produces a bug ("the pill only bumps the first time") that nobody
   attributes to a tidying commit three weeks earlier. Comment it as load-bearing.

6. **A toast that vanishes before it can be read is worse than no toast.** 3.2 seconds is fine
   for "+40 MW" and theft for a sentence, and the toasts worth reading are the long ones. Hence
   duration scaling with length, holding while hovered, a tap to dismiss early, and a visible
   life bar — the bar is what makes a timed message feel deliberate rather than stolen. And a
   hard cap: a wall of toasts hides the game they are about.

7. **A thumbnail cache key that omits the brand serves stale art after a recolour**, and one
   that includes it grows without bound as the player plays with the colour picker. Both halves
   are real: the source game keyed on `${id}|${brand}|${w}x${h}` into an unbounded `Map` of
   `data:` URLs. The design here inverts it — the key does *not* name the brand, `setBrand`
   invalidates, and the cache is LRU-bounded — so neither mistake is available to a caller.

8. **`devicePixelRatio` must be clamped.** A 3x phone painting a 240x140 card allocates a
   720x420 canvas and nine times the fill per shop item; twelve cards is a visible stall on the
   frame the shop opens. Clamp to 2, as the source game does, and paint cards lazily on open
   rather than at boot.

9. **`getContext('2d')` returns `null`, and `!` is where the compiler was told to stop
   helping** *(trap 14)*. In the source game a single `!` on a possibly-empty array shipped a
   black screen to two of four biomes. There is no `!` and no `any` in this package: a null
   context throws an error that names what happened, and `thumbnails` is the only place that
   can produce one.

10. **`position: fixed` inside a transformed ancestor is not fixed.** A `transform`, `filter`
    or `will-change` anywhere on the root or a layer silently re-parents every fixed descendant
    to that element — a modal scrim that no longer covers the viewport, a toast column anchored
    to the wrong thing. It is invisible until someone adds a slide-in animation to the root.
    `auditOverlay` reports it; the root's own animations are on children, never on the root.

11. **Sizing the root with `100vh`.** On iOS Safari `100vh` is the viewport *with the URL bar
    collapsed*, so the bottom of the overlay sits under the browser chrome until the player
    scrolls — which a game with `overscroll-behavior: none` never does. `position: fixed;
    inset: 0` is correct and is what the root uses.

12. **Listeners that outlive their nodes.** Listeners bound through `el`'s `on*` keys are on
    the node itself and are collected with it, which is fine. Listeners on `window`, `document`
    or `visibilitychange` are not, and every one of them in this package must be owned by a
    `Dispose` that `overlay.destroy()` calls. A controller that cannot be torn down leaks a
    whole game — and under Vite HMR it leaks a second one that also thinks it owns the canvas.

13. **A palette pushed from the frame loop is trap 3 wearing a new hat.** It is the most
    natural place to put it — the palette is derived from the same `t` that tints the world, and
    the world is drawn there — and it is wrong twice over. It stops in a backgrounded tab, so
    the player returns to a night scene under a noon HUD until the next state tick; and while it
    is running it invalidates the whole overlay's style sixty times a second to move a colour a
    player perceives over minutes. The state cadence is the right place, and the correct way to
    make one-second steps look continuous is a `transition` in the game's stylesheet, which the
    compositor runs and a hidden tab simply skips.

14. **Floats that outlive their animation.** Web Animations do not run in a hidden tab, so
    `onfinish` never fires and the recycler never gets the node back. Expiry must be driven by
    the state cadence — compare `now` against the spawn time — with the animation callback as
    an optimisation, never as the mechanism. The same applies to toasts.

---

## Appendix — routed elsewhere

Things this RFC needs that are not this package's to build. Each is a one-line task for the
orchestrator, not a change I can make from here.

- **`@lattice/draw`** must export an offscreen `Surface` factory over a `<canvas>` and a way
  to get a `data:` URL out of it, plus `hueToHex(hue, sat?, light?)`. Without the first,
  `thumb` cannot exist; without the second, `theme` duplicates a colour model that already
  lives in `draw` — and two colour models is how a HUD accent stops matching the buildings.
- **`@lattice/draw` owns palette interpolation** and must export it as a function of two
  palettes and a `t` in 0..1 returning a plain name-to-CSS-colour bag (`lerpPalette(a, b, t)`
  in the demo RFC's spelling). `applyPalette` accepts exactly that shape and nothing narrower,
  so the seam is one structural type and neither side imports the other's opinions. The demo
  should quantise `t` — 1/64 steps over a dusk is beyond what anyone can see — so that the
  overlay's per-key change guard turns most pushes into no-ops.
- **`@lattice/core`** owns `fmt`, `fmtRate`, `fmtDuration` (its `format` module) and
  `easeOutCubic` (its `easing` module). This package imports the easing and deliberately does
  not import the formatters.
- **`@lattice/core`'s `Vec2` must be a mutable `{ x, y }`**, or every out-parameter signature
  in the kit needs a second type. `ScreenPoint` here is declared structurally so `ui` compiles
  either way, but the kit should have one answer.
- **`@lattice/input` needs pointer capture on the canvas.** With this overlay, a camera drag
  that starts on the world and passes under an interactive panel loses its move events unless
  the canvas captured the pointer. That is an `input` fix; the overlay cannot help.
- **Nothing in the kit anchors a persistent DOM node to a world entity.** Floats solve the
  one-shot case via `project`. A *persistent* label — a building's name tag, a progress ring
  over a construction site — needs a world→screen conversion every frame for as long as it
  exists, and today that is the game's loop calling `iso`'s projection and writing `style.left`.
  If the demo game writes that three times, it is a primitive, and the honest place for it is
  here with `iso`'s projection injected the same way `project` is.
