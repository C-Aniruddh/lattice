/**
 * `@browser-only` — the one module in this package that names a global.
 *
 * `@latticekit/ui` is a browser package: `HTMLElement` is in half its signatures and there is no
 * pretending otherwise. But *naming a type* and *reaching for an ambient object* are different
 * risks, and only the second one makes a module untestable. Everything else here takes its
 * document, its element or its clock as an argument; this file is where `document`,
 * `getComputedStyle`, `devicePixelRatio`, `setInterval` and `requestAnimationFrame` are read,
 * and it is four dozen lines long so that the other nine modules can run under `node` against
 * a stand-in.
 *
 * Two rules hold it to that size:
 *
 * 1. **Nothing here returns a handle whose type is ambient.** `hostInterval` and
 *    `hostFrameLoop` hand back a `Disposer`, not a timer id, because a timer id is `number` in
 *    the DOM lib and `NodeJS.Timeout` under `@types/node`, and a package that spells either of
 *    them out has picked a host.
 * 2. **Every accessor says what is missing.** A `undefined is not an object` from deep inside a
 *    toast is an afternoon; `createOverlay: no document — @latticekit/ui is a browser package` is
 *    a line of the caller's own code.
 */

import type { Disposer } from '@latticekit/core';

/**
 * The document the overlay builds into when the caller named no parent.
 *
 * @throws Error, naming this package as browser-only, when there is no document. That is the
 * error a Node test or a server render deserves: silently building a detached tree instead
 * would produce a HUD that mounts, ticks, updates and is never seen by anybody.
 */
export function hostDocument(): Document {
  const doc: unknown = globalThis.document;
  if (doc === undefined || doc === null) {
    throw new Error(
      '@latticekit/ui: no document — this is a browser package. Pass `parent` if you have an element from another document, or run this in a browser.',
    );
  }
  return doc as Document;
}

/**
 * Resolved styles for one element, for `auditOverlay` and nothing else.
 *
 * Returns `undefined` rather than throwing where the host cannot compute styles, because the
 * audit is a dev-time convenience and a HUD that crashes on the way to telling you a tap was
 * swallowed has made the day worse.
 */
export function hostComputedStyle(element: Element): CSSStyleDeclaration | undefined {
  const view: unknown = element.ownerDocument.defaultView;
  if (view === undefined || view === null) return undefined;
  const get = (view as { getComputedStyle?: (e: Element) => CSSStyleDeclaration }).getComputedStyle;
  if (typeof get !== 'function') return undefined;
  return get.call(view, element);
}

/**
 * The window's device pixel ratio, or 1 where there is no window.
 *
 * Deliberately *unclamped* here — `thumb` clamps it, because the clamp is a thumbnail policy
 * (trap 8: a 3× phone pays nine times the fill for a shop card) and not a fact about the host.
 * A module that reads a policy-adjusted value from its adapter cannot be given a different
 * policy later.
 */
export function hostPixelRatio(): number {
  const ratio: unknown = globalThis.devicePixelRatio;
  return typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * Start a repeating timer and hand back the only way to stop it.
 *
 * Used by exactly one caller — `driver: 'standalone'` — and that is the whole reason it is
 * separate: a grep for `hostInterval` finds every clock this package can start, and there is
 * one, behind an option whose default is off.
 *
 * @throws Error if the host has no `setInterval`.
 */
export function hostInterval(fn: () => void, ms: number): Disposer {
  const start: unknown = globalThis.setInterval;
  if (typeof start !== 'function') {
    throw new Error("@latticekit/ui: driver 'standalone' needs setInterval, and this host has none");
  }
  const stop: unknown = globalThis.clearInterval;
  const id: unknown = (start as (f: () => void, d: number) => unknown)(fn, ms);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (typeof stop === 'function') (stop as (handle: unknown) => void)(id);
  };
}

/**
 * Run `fn` once per animation frame until the returned disposer is called.
 *
 * The frame's timestamp argument is **not** passed on, and that is invariant 16 rather than an
 * oversight: rAF's clock is not the clock the loop was given, and a roll animating on one while
 * the toast that announced it expires on the other is a HUD that disagrees with itself by a few
 * frames in a way nobody can reproduce.
 *
 * @throws Error if the host has no `requestAnimationFrame`.
 */
export function hostFrameLoop(fn: () => void): Disposer {
  const request: unknown = globalThis.requestAnimationFrame;
  if (typeof request !== 'function') {
    throw new Error(
      "@latticekit/ui: driver 'standalone' needs requestAnimationFrame, and this host has none",
    );
  }
  const cancel: unknown = globalThis.cancelAnimationFrame;
  const ask = request as (f: () => void) => unknown;
  let handle: unknown = undefined;
  let stopped = false;
  const step = (): void => {
    if (stopped) return;
    handle = ask(step);
    fn();
  };
  handle = ask(step);
  return () => {
    if (stopped) return;
    stopped = true;
    if (typeof cancel === 'function') (cancel as (h: unknown) => void)(handle);
  };
}
