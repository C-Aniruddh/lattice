---
name: hud
description: Putting numbers, buttons, messages and panels on top of a game — a resource counter, a price, a build button, a toast, a dialog, floating +5s. Use when adding a HUD, an overlay, a score or resource display, a shop button, a notification, a modal; when a tap on the game is being swallowed by the interface; or when the HUD freezes or shows stale numbers after switching tabs.
---

# HUD

The whole overlay of a game HUD is a few dozen DOM nodes that change a few times a second. A
virtual DOM would be more code than the UI it manages, so there is not one.

**The package ships no stylesheet at all.** It writes structure, `pointer-events`, and
`--lattice-*` custom properties, and holds no opinion about anything else. So your `<style>`
block *is* the HUD's art direction — that is a feature, and it is why there is no theme to fight.

---

## The whole thing

```ts
import { fmtCompact } from '@latticekit/core';
import { browserFrames, createLoop } from '@latticekit/loop';
import { createOverlay, drive, el, interactive, roll, setText, toasts } from '@latticekit/ui';

interface Model {
  readonly coin: number;
  readonly price: number;
  readonly affordable: boolean;
  readonly objective: string;
}

export function createHud(read: () => Model, onBuy: () => void) {
  const now = (): number => performance.now();
  const loop = createLoop({ clock: { now }, frames: browserFrames() });
  const ui = createOverlay({ now });   // the SAME clock. Two clocks in one HUD is the bug below

  const coin = roll(ui, { format: fmtCompact });
  const objective = el('p', { class: 'objective' });
  const buy = interactive(el('button', { class: 'buy' }, 'Build'));
  buy.addEventListener('click', onBuy);

  ui.mount(el('div', { class: 'hud' }, objective, 'Coin ', coin.node, buy), { interactive: true });

  // State on UPDATE. If `render` never runs — a hidden tab — every number here is still right.
  ui.every(() => {
    const m = read();
    coin.set(m.coin);
    setText(objective, m.objective);              // writes only on change, and says whether it did
    setText(buy, `Build · ${Math.ceil(m.price)}`);
    buy.classList.toggle('is-affordable', m.affordable);
    buy.toggleAttribute('disabled', !m.affordable);
  });

  drive(ui, loop);      // update → ui.tick, render → ui.repaint. Never the other way
  loop.start();

  toasts(ui).show('The light is lit', 'good');
  return { ui, loop };
}
```

Five lines, five decisions already made:

| the line | the decision |
|---|---|
| `createOverlay` | the root is `pointer-events: none` **inline**, and there is no stylesheet — a tap that is not on a node you named reaches the world |
| `roll` | the number animates on paint and is *correct* on update: if `render` never runs the text is still right |
| `ui.every` | the state cadence is the loop's `update`. This package starts **no timer and no rAF loop** |
| `drive` | the pairing it is fatal to cross is a function body, not a comment |
| `fmtCompact` | formatting comes from `@latticekit/core`. This package has no `fmt` and never will |

---

## The two cadences, and why one of them is not optional

| | `ui.every` / `tick()` | `ui.paint` / `repaint()` |
|---|---|---|
| driven by | the loop's `update` — wall time | the loop's `render` — `requestAnimationFrame` |
| in a hidden tab | runs | **0 Hz** |
| put here | anything whose absence makes the HUD **wrong** | anything whose absence makes it **plainer** |
| examples | prices, affordability, disabled buttons, build timers, toast expiry, the day/night palette | eased numbers, re-projected floats |

There is no third registration point and no way to put a state update inside `render`. That is
not tidiness. **A HUD updated in the render callback freezes in a background tab while the canvas
keeps showing its last painted frame**, so the game *looks* alive with prices, timers and
affordability marks that stopped twenty minutes ago.

And the fix for that is **not** a `setInterval` of your own. `update` already is the interval. A
second clock beside the loop's is a HUD polling while the simulation settles — which is how a
one-shot dialog reopens *blank* after a confirm, and how the obvious recovery (press confirm
again) overwrote the company name a player had just typed. That is a true story and it is why
`drive` exists as a function rather than as a paragraph of advice.

---

## The pointer contract

> The overlay root is `pointer-events: none`, set **inline**. Interactivity is granted to
> **nodes**, never by selector: `interactive(node)` writes `pointer-events: auto` inline on
> exactly the node it is given, and it inherits from there to its children.
>
> **If a tap should reach the world, do nothing. If it should not, name the node.**

`ui.mount(node)` writes the inline `none` for you, so the guarantee survives a game stylesheet
that says `.lattice-layer > * { pointer-events: auto }` — that rule targets your node, and your
node has an inline declaration that outranks it.

When a tap goes missing anyway:

```ts
import { auditOverlay } from '@latticekit/ui';
import type { Overlay } from '@latticekit/ui';

export function whyIsMyTapGone(ui: Overlay): readonly string[] {
  return auditOverlay(ui);   // one English sentence per problem
}
```

It catches a node granted `auto` by a stylesheet rather than by `interactive()`, and a
`transform`, `filter` or `will-change` on the root or a layer — which silently re-parents every
`position: fixed` descendant and leaves a scrim covering less than the viewport.

---

## Latches, because driving UI from a poll is the natural mistake

```ts
import { acknowledge, panel, toasts } from '@latticekit/ui';
import type { Overlay } from '@latticekit/ui';

export function wireMessages(ui: Overlay, read: () => { naming: boolean; storage: string }): void {
  const namer = panel(ui, { modal: true });
  const toast = toasts(ui);

  ui.every(() => {
    const s = read();
    if (s.naming) namer.openOnce();                          // correct at ANY poll rate
    if (s.storage === 'not-persistent') {
      toast.once('storage-not-persistent', 'This browser may not keep your progress');
    }
  });
}

export async function saveStopped(ui: Overlay): Promise<void> {
  await acknowledge(ui, {
    title: 'Saving has stopped',
    body: 'A newer version of the game wrote this save. Your progress is safe, but nothing from now on is being recorded.',
    confirmText: 'I understand',
  });
}
```

`Panel.openOnce()` and `ToastHost.once(key, …)` are the same idea at two sizes, and both exist
because the natural way to drive UI from a game — check a condition on every update — is a poll,
and a poll without a latch either repeats or reopens.

**`once` keys on the condition, never the rendered text.** A message carrying a byte count or an
attempt number changes on every rediscovery and defeats a latch keyed on it — a deduplication
that stops deduplicating in precisely the case it was written for.

**The choice between a toast and an acknowledge is not how alarming the message sounds. It is
what the player loses by missing it.** Storage that may not persist is a toast, because they can
do nothing about it and must not be blocked at the door. A save that has stopped being written is
an `acknowledge`, because everything they do from now on is unrecorded and a dismissible notice
about that is a notice designed to be missed.

`acknowledge` works before the first `tick()` — a message about a session that is not running
must not depend on the session running — and its promise **never settles** if the overlay is
destroyed unacknowledged, because a continuation written after "the player agreed" must not run
when they did not.

---

## Day and night reaching the HUD

```ts
import { DAY, NIGHT, createPalette, paletteVars } from '@latticekit/draw';
import { applyPalette } from '@latticekit/ui';
import type { Overlay } from '@latticekit/ui';

const palette = createPalette(DAY);
let pushedRev = -1;

export function dusk(ui: Overlay, t: number): void {
  palette.lerp(NIGHT, DAY, t);
  if (palette.rev === pushedRev) return;      // `lerp` quantizes, so most updates are no-ops
  pushedRev = palette.rev;
  // `paletteVars` is the bridge. `applyPalette` takes a bag of name → CSS string, NOT
  // draw's Palette object — passing the object straight in is a type error, and it is a
  // type error on purpose: the two are different things with the same word for a name.
  applyPalette(ui, paletteVars(palette));     // from UPDATE, never from render
}
```

`applyPalette` writes the palette onto the root as CSS custom properties, guarded per key, and
returns whether anything moved. Three properties make that correct rather than merely cheap:

1. **It is change-guarded per key**, so pushing on every update is wasteful rather than wrong.
   Quantize `t` on your side — 1/64 is beyond what anyone can see over a dusk.
2. **Smoothing is a CSS transition, not a JavaScript tween.**
   `transition: background-color 1.2s linear` in *your* sheet runs on the compositor, needs no
   frame callback, and degrades to an instant jump in a hidden tab, which is correct because
   nobody is looking.
3. **It does not invalidate thumbnails**, unlike `setBrand`. A shop card is a portrait of the
   building, not a photograph of it at this hour.

Write it from `update`. A palette pushed from `render` stops in a backgrounded tab, and the
player comes back to a night world under a noon HUD.

**Set the daylight values as CSS fallbacks** — `var(--lattice-ink, #1b2436)` — so the first paint
is right before a single frame has run.

---

## What `ui` does not have, so you stop looking for it

**No button. No toggle. No segmented control. No slider.** The package ships `roll`, `panel`,
`toasts`, `floats`, `thumbnails` and `acknowledge`, and an exhibit's *one control* is usually none
of those. Two separate games hand-wrote two different missing primitives — one an
`<input type="range">` with about 35 lines of vendor-pseudo-element CSS, one a raise/cut toggle.
Write a plain element, call `interactive()` on it, style it in your sheet. That is the intended
path, not a workaround.

**`roll` animates toward its target, which is wrong for a number under test.** A 200-unit jump
takes about **10 seconds** to settle, so a diagnostic readout displays a wrong number for the
whole interval somebody is looking at it. Use `roll.snap(v)` — or a plain `setText` — for a frame
counter, a live object count, or anything a reviewer is reading. Keep the roll for gold.

**`acknowledge` deliberately refuses to become a dialog system**: two buttons is a choice, not an
acknowledgement. A real dialog is `panel({ modal: true })` plus `el` directly, and it comes to
about nine lines. What `panel({ modal: true })` gives you free is a scrim, a focus trap and
Escape; doing it on the canvas instead gives you two rectangles you hit-test yourself, a world
that still takes taps behind the dialog, and nothing at all for a keyboard-only player.

---

## Small things that are load-bearing

- **The complete list of CSS properties this package ever writes inline is `position`, `inset`,
  `left`, `top`, `z-index`, `pointer-events` and `display`** — plus custom properties. Nothing
  decorative: no color, no font, no radius, no shadow. That list is a test, and it is the boundary
  between "primitives" and "a look you have to fight".
- **`clip-path` clips the border and the box-shadow too.** A hairline on a clipped card has to be
  a second clipped layer inset by a pixel — and it must be `::before` rather than `::after`,
  because `::after` is the last child and would paint over the card's own text.
- **`setText` writes only on change and returns whether it did.** That guard replaced 37
  hand-written `lastX` fields in one game and costs 22 ns when nothing moved.
- **Everything returns a disposer or a handle with `destroy()`**, and everything is registered on
  the overlay, so `ui.destroy()` is a complete teardown. A game that hot-reloads twice must not
  end up with two overlays driving one canvas.
- **A busy HUD costs about 4.5 µs of an 8 ms frame.** If your HUD is your performance problem,
  measure again — it is almost certainly the canvas.

---

## What this skill does not cover

| you want | read |
|---|---|
| the loop `drive` needs, and the one-clock rule | `starting` |
| the palette the HUD is reading | `art` |
| taps on the world rather than on a button | `input` |
| what the numbers mean | `economy` |
| the status a message is reporting | `saving` |

Long form, on disk: `node_modules/@latticekit/ui/README.md` — including the full list of class names
your stylesheet may hold on to.
