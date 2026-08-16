# @lattice/ui

> DOM overlay primitives — a pointer-transparent overlay, an element builder, panels, toasts,
> number rolls, floating feedback and canvas thumbnails. Deliberately **not** a framework.

Part of **[Lattice](https://github.com/C-Aniruddh/lattice)** — the grid underneath.

```bash
npm i @lattice/ui
```

The whole overlay of a game HUD is a few dozen nodes that change a few times a second. A virtual
DOM would be more code than the UI it manages, so there isn't one. What is here is the handful
of things a HUD cannot avoid needing, and the six or seven decisions that are hard to get right
the first time.

---

## The example

Put a number on the screen, keep it right, and say something when an event happens.

```ts
import { fmtCompact } from '@lattice/core';
import { browserFrames, createLoop } from '@lattice/loop';
import { createOverlay, drive, el, roll, toasts } from '@lattice/ui';

const now = (): number => performance.now();
const loop = createLoop({ clock: { now }, frames: browserFrames() });
const ui = createOverlay({ now }); // the same clock. Two clocks in one HUD is the bug below.

const gold = roll(ui, { format: fmtCompact });
ui.mount(el('div', { class: 'hud' }, 'Gold ', gold.node), { interactive: true });
ui.every((nowMs) => {
  gold.set(wallet.goldAt(nowMs));
});

drive(ui, loop); // `update` drives ui.tick, `render` drives ui.repaint. Never the other way.
loop.start();

toasts(ui).show('Refinery online', 'good');
```

That body is executed by `packages/ui/test/overlay.test.ts` ("the README example") against an
injected clock and a stand-in loop — the two `performance.now()` lines are the only difference,
because a real `createLoop` needs a browser to pump it. It asserts what you would look for: the
gold reads `1.2K`, the toast is in the top layer, `auditOverlay` is silent, and `ui.destroy()`
leaves nothing behind.

Five lines, and five decisions are already made for you:

| the line | the decision |
|---|---|
| `createOverlay` | the root is `pointer-events: none` **inline**, and there is no stylesheet — a tap that is not on a node you named reaches the world |
| `roll` | the number animates on paint and is *correct* on update: if `render` never runs, the text is still right |
| `ui.every` | the state cadence is the loop's `update`. This package starts **no timer and no rAF loop** |
| `drive` | the pairing it is fatal to cross is a function body, not a comment |
| `format` | formatting comes from `@lattice/core`. This package has no `fmt` and never will |

---

## The two cadences

|  | `ui.every` / `tick()` | `ui.paint` / `repaint()` |
|---|---|---|
| driven by | the loop's `update` — wall time | the loop's `render` — `requestAnimationFrame` |
| in a hidden tab | runs | **0 Hz** |
| put here | anything whose absence makes the HUD **wrong** | anything whose absence makes it **plainer** |
| examples | prices, affordability, disabled buttons, build timers, toast expiry, the day/night palette | eased numbers, re-projected floats |

There is no third registration point and no way to put a state update inside `render`. That is
not tidiness. A HUD updated in the render callback freezes in a background tab while the canvas
keeps showing its last painted frame, so the game *looks* alive with prices, timers and
affordability marks that stopped twenty minutes ago.

And the fix for that is **not** a `setInterval` of this package's own. `update` already is the
interval. A second clock beside the loop's is a HUD polling while the simulation settles — which
is how a one-shot dialog reopens *blank* after a confirm, and how the obvious recovery (press
confirm again) overwrites the name the player just typed. `driver: 'driven'` is the default for
this reason, and `driver: 'standalone'` — for a menu or a component page with no game behind it
— makes `tick()` throw so the two can never both be running.

If your host has no loop at all, call `ui.tick(nowMs)` yourself. Everything works; `drive` is
just the two lines it is dangerous to write backwards.

---

## The pointer contract

> The overlay root is `pointer-events: none`, set **inline**. Interactivity is granted to
> **nodes**, never by selector: `interactive(node)` writes `pointer-events: auto` inline on
> exactly the node it is given, and it inherits from there to its children. This package ships
> **no stylesheet at all**, and in particular no rule of the form `#ui > *`, so there is nothing
> for a game's `.spacer { pointer-events: none }` to lose a specificity fight against.
>
> **If a tap should reach the world, do nothing. If it should not, name the node.**

`ui.mount(node)` writes the inline `none` for you, so the guarantee survives a game stylesheet
that says `.lattice-layer > * { pointer-events: auto }` — that rule targets your node, and your
node has an inline declaration that outranks it.

When a tap does go missing anyway, `auditOverlay(ui)` returns one English sentence per problem:
a node granted `auto` by a stylesheet rather than by `interactive()`, and a `transform`, `filter`
or `will-change` on the root or a layer, which silently re-parents every `position: fixed`
descendant and leaves the scrim covering less than the viewport.

---

## The surface

```ts
// overlay — the root, the layers, the cadences
createOverlay(opts): Overlay      // { root, modalOpen, layer, mount, every, paint, tick, repaint, destroy }
drive(ui, loop): Disposer         // update → tick, render → repaint
auditOverlay(ui): readonly string[]

// el — the builder and the four write helpers
el(tag, attrs?, ...children)      // no `html` key, ever
clear(node)
setText(node, text): boolean      // writes only on change, and says whether it did
show(node, on?) / hide(node)      // inline `display`, `!important`, so a stylesheet cannot win
pulse(node, className?)           // restarts a CSS animation, forced reflow and all
interactive(node) / passthrough(node)

// panel — sheets, modals, and the things that must be answered
panel(ui, opts?): Panel           // { node, isOpen, open, openOnce, close, destroy }
acknowledge(ui, opts): Promise<void>

// toast — the game talking to the player, briefly
toasts(ui, opts?): ToastHost      // { show, once, clear, destroy }

// roll — numbers that move, and numbers that fly
roll(ui, opts?): Roll             // { node, value, set, snap, destroy }
floats(ui, opts?): FloatHost      // { spawn, destroy }

// thumb — the one bridge from @lattice/draw to the DOM
thumbnails(ui, capacity?): ThumbCache   // { url, invalidate, size, destroy }

// theme — one hue, one palette, no design system
setBrand(ui, hue, opts?)
setTokens(ui, tokens)
applyPalette(ui, palette, opts?): boolean
```

Every one of those returns a `Disposer` or a handle with `destroy()`, and every one of them is
also registered on the overlay, so `ui.destroy()` is a complete teardown. A game that hot-reloads
twice must not end up with two overlays driving one canvas.

### The two latches

`Panel.openOnce()` and `ToastHost.once(key, …)` are the same idea at two sizes, and both exist
because the natural way to drive UI from a game — check a condition on every update — is a poll,
and a poll without a latch either repeats or reopens.

```ts
ui.every(() => {
  if (quest.isNaming) namer.openOnce();                       // correct at any poll rate
  if (store.status === 'not-persistent') {
    toasts.once('storage-not-persistent', 'This browser may not keep your save');
  }
});

if (store.status === 'refusing-newer') {
  await acknowledge(ui, {
    title: 'Saving has stopped',
    body: 'A newer version of the game wrote this save. Your progress is safe, but nothing from now on is being recorded.',
    confirmText: 'I understand',
  });
}
```

**`once` keys on the condition, never the rendered text.** `@lattice/persist` exposes
`store.status` as a bare union member for exactly this: a message carrying a byte count or an
attempt number changes on every rediscovery and defeats a latch keyed on it — a deduplication
that stops deduplicating in precisely the case it was written for.

The choice between the two is not how alarming the message sounds. It is **what the player loses
by missing it**: storage that may not persist is a toast, because they can do nothing about it
and must not be blocked at the door; a save that has stopped being written is an `acknowledge`,
because everything they do from now on is unrecorded and a dismissible notice about that is a
notice designed to be missed.

`acknowledge` works before the first `tick()` — a message about a session that is not running
must not depend on the session running — and its promise **never settles** if the overlay is
destroyed unacknowledged, because a continuation written after "the player agreed" must not run
when they did not.

---

## What the stylesheet gets

The package ships no CSS, so the only things your sheet can hold on to are the node structure and
these names. Renaming one is a breaking change.

| class | on |
|---|---|
| `lattice-ui` | the overlay root |
| `lattice-layer`, `lattice-layer-floats` / `-panels` / `-modal` / `-toasts` | the four layer containers, bottom to top |
| `lattice-panel`, `lattice-panel-modal` | a panel |
| `lattice-scrim` | the modal scrim |
| `lattice-ack`, `lattice-ack-title`, `lattice-ack-body`, `lattice-ack-confirm` | the four nodes `acknowledge` builds |
| `lattice-toast`, `lattice-toast-plain` / `-good` / `-bad`, `lattice-toast-bar` | a toast and its life bar |
| `lattice-roll` | a roll's default node |
| `lattice-float`, `lattice-float-gain` / `-loss` / `-plain` | a floating number |

Plus the custom properties: `--lattice-brand`, `--lattice-brand-hi`, `--lattice-brand-lo` from
`setBrand`, and `--lattice-<key>` for every key of a palette pushed through `applyPalette`. Your
sheet reads them; nothing in this package ever reads them back.

**The complete list of CSS properties this package ever writes to an inline style is `position`,
`inset`, `left`, `top`, `z-index`, `pointer-events` and `display`** — plus custom properties.
Nothing decorative: no colour, no font, no radius, no shadow. That list is a test, and it is the
boundary between "primitives" and "a look you have to fight".

Two motions are exceptions and are set through the Web Animations API rather than a stylesheet,
because a kit that ships zero assets cannot ship a keyframe: a float rises and fades, and a toast's
life bar scales down. Everything else about how they look is yours.

---

## Day and night

```ts
ui.every(() => applyPalette(ui, lerpPalette(DAY, NIGHT, world.dayT)));
```

`@lattice/draw` owns the colour model and hands over a bag of name → CSS string; this writes it
onto the root as custom properties, guarded per key, and returns whether anything moved. Three
properties make that correct rather than merely cheap:

1. **It is change-guarded per key**, so pushing on every update is wasteful rather than wrong.
   Quantise `t` on your side — 1/64 is beyond what anyone can see over a dusk — and the guard
   turns most pushes into no-ops.
2. **Smoothing is a CSS transition, not a JavaScript tween.** `transition: background-color 1.2s
   linear` in *your* sheet runs on the compositor, needs no frame callback, and degrades to an
   instant jump in a hidden tab, which is correct because nobody is looking.
3. **It does not invalidate thumbnails**, unlike `setBrand`. A shop card is a portrait of the
   building, not a photograph of it at this hour.

Write it from `update`, never from `render`: a palette pushed from `render` stops in a
backgrounded tab, and the player comes back to a night world under a noon HUD.

---

## Numbers

`npm run bench -- packages/ui`, on an M-series laptop, against the DOM double described below.
The frame budget the whole kit works to is **8 ms**.

| path | per call | what it is |
|---|---|---|
| `setText`, unchanged | **22 ns** | the change guard that replaced 37 `lastX` fields |
| `setText`, changed | 74 ns | |
| cadence dispatch, 32 subscribers | **51 ns** | one `tick()` or `repaint()` of a large HUD |
| expire 24 floats from `update` | 53 ns | |
| roll paint step | 250 ns | one eased number, one frame |
| `floats.spawn` | 339 ns | the hot path in a collect-and-spend game — and it creates no element |
| `applyPalette`, unchanged (10 keys) | **991 ns** | the guard that makes a dusk free |
| `applyPalette`, every key changed | 1.2 µs | |

A busy HUD — twelve rolls, a float, a palette push, thirty-two subscribers — costs about **4.5 µs
of an 8 ms frame**, which is 0.06% of it. These figures measure this package's own arithmetic and
bookkeeping; what they cannot measure is the browser's own cost, and that is the point of the
guards. A custom property written on the root invalidates style for every node that inherits it,
which is the entire overlay; the 991 ns above is what it costs *not* to do that sixty times a
second.

---

## Testing, and the dependency that isn't here

The kit has **no dependencies at all** — not in `src`, not in `devDependencies` — and this package
did not get to be the exception. `packages/ui/test/dom.ts` is a hand-written, three-hundred-line
double of the platform subset this package touches, and the suite runs in Node with vitest's
default `node` environment. Coverage is **100% of statements, branches, functions and lines**
across all ten modules.

What that proves: everything this package *decides* — which nodes exist, in which layer, in which
order, with which classes and which inline properties; which listener is bound to what; and, for
half the tests, what is **not** written. What no test in Node can prove is the CSS cascade. The
design is what answers that: the package ships no stylesheet, so there is no descendant rule to
lose a specificity fight against; everything it writes is inline, which beats any author rule that
is not `!important`; `hide()` writes `!important` so that even that case is covered; and
`auditOverlay` is the runtime check for a game that adds a rule anyway.

`src/host.ts` is the only module that names a global — `document`, `getComputedStyle`,
`devicePixelRatio`, `setInterval`, `requestAnimationFrame` — and it is marked `@browser-only`, so
`npm run lint` counts it. Every other module takes its document, its element or its clock as an
argument.

---

## What is deliberately absent

A virtual DOM, reactivity or signals · state binding · a component library · a layout engine · a
stylesheet, theme preset or dark mode · input handling (`@lattice/input`) · colour interpolation
(`@lattice/draw`) · a dialog system beyond one-button `acknowledge` · persistence of any kind
(`@lattice/persist` owns saved state; `once` latches for this session only) · a clock, a scheduler
or a rAF loop (`@lattice/loop`) · tweening (`@lattice/loop`, `@lattice/core`) · number formatting
(`@lattice/core`) · a camera or world-space anchoring (`@lattice/iso`, through
`FloatOptions.project`) · a scene/route state machine · canvas rendering (`@lattice/draw`;
`thumb` is the single bridge and it draws nothing) · tooltips, context menus, drag-and-drop,
virtualised lists.

Each of those has an obvious first version that is fifteen lines and a mature version that is a
framework. The three widgets that *are* here earn it by owning **behaviour** — a focus trap, a
hold-on-hover expiry, a recycling pool — not appearance.

---

MIT © Lattice
