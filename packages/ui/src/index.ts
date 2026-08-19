/**
 * `@latticekit/ui` — the handful of DOM primitives a game HUD cannot avoid needing, and
 * deliberately not a framework.
 *
 * ```ts
 * import { fmtCompact } from '@latticekit/core';
 * import { createOverlay, drive, el, roll, toasts } from '@latticekit/ui';
 *
 * const ui = createOverlay({ now: () => performance.now() });
 * const gold = roll(ui, { format: fmtCompact });
 * ui.mount(el('div', { class: 'hud' }, 'Gold ', gold.node), { interactive: true });
 * ui.every((nowMs) => { gold.set(wallet.goldAt(nowMs)); });
 * drive(ui, loop); // `update` drives ui.tick, `render` drives ui.repaint. Never the other way.
 * ```
 *
 * Five lines, and five of this package's decisions are already made for the caller.
 *
 * | the line | the decision |
 * |---|---|
 * | `createOverlay` | the root is `pointer-events: none` **inline**, and there is no stylesheet — so a tap that is not on a node you named reaches the world |
 * | `roll` | the number animates on paint and is *correct* on update: if `render` never runs, the text is still right |
 * | `ui.every` | the state cadence is the loop's `update`. This package starts **no timer and no rAF loop** |
 * | `drive` | the pairing it is fatal to cross is a function body, not a comment |
 * | `format` | formatting comes from `@latticekit/core`. This package has no `fmt` and never will |
 *
 * ## The two cadences, which is the whole design
 *
 * | | `ui.every` / `tick()` | `ui.paint` / `repaint()` |
 * |---|---|---|
 * | driven by | the loop's `update` — wall time | the loop's `render` — rAF |
 * | in a hidden tab | runs | **0 Hz** |
 * | put here | anything whose absence makes the HUD **wrong** | anything whose absence makes it **plainer** |
 *
 * There is no third registration point, and no way to put a state update inside `render`. That
 * is not tidiness: a HUD updated in the render callback freezes in a background tab while the
 * canvas keeps showing its last painted frame, so the game *looks* alive with prices, timers and
 * affordability marks that stopped twenty minutes ago.
 *
 * And the fix for that is **not** a `setInterval` of this package's own. `update` already is the
 * interval. A second clock beside the loop's is a HUD polling while the simulation settles,
 * which is how a one-shot dialog reopens blank after a confirm and the obvious recovery
 * overwrites what the player typed. `driver: 'driven'` is the default for this reason, and
 * `driver: 'standalone'` makes `tick()` throw so the two can never both be running.
 *
 * ## The class names are public API
 *
 * The package ships no CSS, so the only thing a game's stylesheet can hold on to is the node
 * structure and these names. Renaming one is a breaking change.
 *
 * | class | on |
 * |---|---|
 * | `lattice-ui` | the overlay root |
 * | `lattice-layer`, `lattice-layer-floats` / `-panels` / `-modal` / `-toasts` | the four layer containers |
 * | `lattice-panel`, `lattice-panel-modal` | a panel wrapper |
 * | `lattice-ack`, `lattice-ack-title`, `lattice-ack-body`, `lattice-ack-confirm` | the four nodes `acknowledge` builds |
 * | `lattice-scrim` | the modal scrim |
 * | `lattice-toast`, `lattice-toast-plain` / `-good` / `-bad`, `lattice-toast-bar` | a toast and its life bar |
 * | `lattice-roll` | a roll's default node |
 * | `lattice-float`, `lattice-float-gain` / `-loss` / `-plain` | a floating number |
 *
 * Two custom-property namespaces are written on the root and are equally public:
 * `--lattice-brand`, `--lattice-brand-hi`, `--lattice-brand-lo` from `setBrand`, and
 * `--lattice-<key>` for every key of a palette pushed through `applyPalette`. Your sheet reads
 * them; nothing in this package ever reads them back.
 *
 * The complete list of CSS properties this package ever writes to an element's inline style is
 * `position`, `inset`, `left`, `top`, `z-index`, `pointer-events` and `display`. Nothing
 * decorative — no color, no font, no radius, no shadow. That list is a test, and it is the
 * boundary between "primitives" and "a look you have to fight".
 */

/** The kit version this package was built as part of. */
export const VERSION = '0.1.1';

// ── the overlay ─────────────────────────────────────────────────────────────────
//
// The root, the pointer contract and the two cadences. `drive` is one export for two lines a
// caller could write, and it earns its place because those two lines are the ones it is fatal
// to cross.

export { auditOverlay, createOverlay, drive } from './overlay.js';
export type {
  Dispose,
  Driven,
  LayerName,
  MountOptions,
  Overlay,
  OverlayOptions,
} from './overlay.js';
export type { CadenceFn } from './cadence.js';

/**
 * One teardown vocabulary for the whole kit, owned by layer 0.
 *
 * Re-exported rather than redeclared: `Scope.add` from `core` has to accept what `ui.every`
 * returns without a cast, and two identical aliases are two things to keep in step. `Dispose`
 * above is an alias of this, kept because the RFC spells it that way.
 */
export type { Disposer } from '@latticekit/core';

// ── elements ────────────────────────────────────────────────────────────────────
//
// `setText` is the one that deletes the most code: it replaces the 37 `private lastX = ''`
// fields in the source game's HUD, and returning whether it wrote is what makes them deletable.

export { clear, el, hide, interactive, passthrough, pulse, setText, show } from './el.js';
export type { Attrs, Child } from './el.js';

// ── panels, and the things that must be answered ────────────────────────────────
//
// `openOnce` and `toasts.once` are the same idea at two sizes. Both exist because the natural
// way to drive UI from a game — check a condition on every update — is a poll, and a poll
// without a latch either repeats or reopens.

export { acknowledge, panel } from './panel.js';
export type { AcknowledgeOptions, Panel, PanelOptions } from './panel.js';

// ── toasts ──────────────────────────────────────────────────────────────────────

export { toasts } from './toast.js';
export type { ToastHost, ToastKind, ToastOptions } from './toast.js';

// ── numbers that move, and numbers that fly ─────────────────────────────────────

export { floats, roll } from './roll.js';
export type { FloatHost, FloatKind, FloatOptions, Roll, RollOptions, ScreenPoint } from './roll.js';

// ── thumbnails: the one bridge from `draw` to the DOM ───────────────────────────

export { thumbnails } from './thumb.js';
export type { ThumbCache, ThumbSpec } from './thumb.js';

// ── theme: one hue, one palette, no design system ───────────────────────────────

export { applyPalette, setBrand, setTokens } from './theme.js';
export type { BrandOptions, Palette, PaletteOptions } from './theme.js';
