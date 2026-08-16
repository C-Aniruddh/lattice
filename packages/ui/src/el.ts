/**
 * The element builder and the four write helpers — the half of this package that deletes the
 * most code from a game.
 *
 * The measure is a shipped game's HUD file: 3,102 lines, 342 hand-written
 * `document.createElement` sequences, 59 `classList` pokes and **37 `private lastX = ''`
 * fields whose entire job was "do not write the DOM if the string did not change"**. Those 37
 * fields are one function here, and the function returns whether it wrote, which is the part
 * that makes them deletable rather than merely shorter.
 *
 * Nothing in this file reads a global except through `host.ts`, and nothing in it writes a
 * decorative style. The complete set of CSS properties this whole package ever assigns is
 * `position`, `inset`, `left`, `top`, `z-index`, `pointer-events` and `display`, plus custom
 * properties; three of those are written here.
 */

import { hostDocument } from './host.js';

/**
 * Attributes for {@link el}.
 *
 * `class` and `text` are special-cased, a key starting with `on` whose value is a function
 * binds a listener, `undefined` and `false` are skipped so a conditional attribute reads
 * inline, and `true` sets a bare attribute.
 */
export type Attrs = Readonly<
  Record<string, string | number | boolean | EventListener | undefined>
>;

/** A child of {@link el}. The falsy members exist so that `cond && el(…)` composes without a
 *  filter — a list built from four optional rows should read as four lines, not as a reduce. */
export type Child = Node | string | false | null | undefined;

/** Attribute keys that are not attributes. Checked before anything else, so a caller cannot
 *  accidentally set a literal `class=""` attribute *and* a class name. */
const CLASS_KEY = 'class';
const TEXT_KEY = 'text';

/**
 * Build an element.
 *
 * ```ts
 * const row = el('div', { class: 'pill', onclick: buy }, 'Gold ', gold.node, unlocked && badge);
 * ```
 *
 * **There is deliberately no `html` key, and passing one throws.** The source game had one, and
 * the first string a game wants to interpolate is the player's own typed company name. An
 * element builder that makes `innerHTML` the short path is a cross-site-scripting hole with
 * good ergonomics, and a silently-ignored `html` key would be the same hole plus a mystery.
 *
 * @throws TypeError naming the key if `html` is passed, or if a function is passed under a key
 * that does not start with `on` — the second is always a typo (`click` for `onclick`), and
 * stringifying a function into an attribute is how it goes unnoticed for a week.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = hostDocument().createElement(tag);
  if (attrs !== undefined) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (value === undefined || value === false) continue;
      if (key === 'html') {
        throw new TypeError(
          "el: there is no `html` key — pass `text`, or build child nodes. Interpolating a player's own typed name into innerHTML is the cross-site-scripting hole this builder exists to not have.",
        );
      }
      if (typeof value === 'function') {
        if (!key.startsWith('on')) {
          throw new TypeError(
            `el: \`${key}\` is a function but does not start with \`on\` — listeners are \`onclick\`, \`onpointerdown\`, and a function set as an attribute is a typo that stringifies silently`,
          );
        }
        node.addEventListener(key.slice(2).toLowerCase(), value);
        continue;
      }
      if (key === CLASS_KEY) {
        node.className = String(value);
      } else if (key === TEXT_KEY) {
        node.textContent = String(value);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }
  appendAll(node, children);
  return node;
}

/** Append the non-falsy children, turning strings into text nodes. Shared by {@link el} and
 *  the widgets, which build their own subtrees the same way. */
function appendAll(node: HTMLElement, children: readonly Child[]): void {
  const doc = node.ownerDocument;
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
  }
}

/**
 * Empty a node.
 *
 * `innerHTML = ''` is the one-liner everybody reaches for and it leaks listeners on some
 * engines — the removed subtree is discarded wholesale rather than detached node by node, and
 * a listener bound to a node that no longer has a parent is a listener nothing will collect.
 * Removing children one at a time costs a loop and leaks nothing.
 */
export function clear(node: Element): void {
  let child = node.firstChild;
  while (child !== null) {
    node.removeChild(child);
    child = node.firstChild;
  }
}

/**
 * Write text only if it changed, and say whether it did.
 *
 * This one function replaces the 37 `private lastX = ''` fields in the source game's HUD, and
 * the return value is why: `if (setText(node, s)) pulse(node)` flashes a change without
 * flashing every tick. A HUD that pulses on every update has taught the player to ignore the
 * pulse, which costs exactly the moment the number *did* move.
 *
 * Compares against `textContent`, so it is correct for a node whose text was written by anyone
 * — including the game's own code before this package saw it.
 */
export function setText(node: Node, text: string): boolean {
  if (node.textContent === text) return false;
  node.textContent = text;
  return true;
}

/**
 * Show or hide, inline and `!important`, so it wins.
 *
 * The user-agent rule behind the `hidden` attribute is `[hidden] { display: none }` at
 * specificity **zero**, and a game's own `.dock { display: flex }` beats it. The source game hit
 * this and ended up restating `[hidden] { display: none !important }` beside every flex element
 * it could hide, which is a rule that has to be remembered once per element for the life of the
 * project. An inline `display: none !important` cannot lose to an author rule at all.
 *
 * The `hidden` attribute is set too — not for the layout, which the inline style already owns,
 * but for assistive technology and for a game's own `:not([hidden])` selectors.
 *
 * Showing **removes** the inline value rather than writing `display: block`, so an element goes
 * back to whatever the game's stylesheet says it is. Writing a display value here would be this
 * package holding an opinion about layout, and it holds none.
 */
export function show(node: HTMLElement, on = true): void {
  if (on) {
    node.style.removeProperty('display');
    node.removeAttribute('hidden');
    return;
  }
  node.style.setProperty('display', 'none', 'important');
  node.setAttribute('hidden', '');
}

/** Hide, inline. `show(node, false)`, named for the call site that reads better. */
export function hide(node: HTMLElement): void {
  show(node, false);
}

/**
 * Restart a CSS animation on a node — the "+1" bump on a resource pill.
 *
 * `classList.remove('bump')` then `classList.add('bump')` in the same task does **nothing at
 * all**: the browser never observes the intermediate state, so there is no transition between
 * two identical computed styles. Reading `offsetWidth` between them forces a synchronous layout,
 * which is what makes the removal observable.
 *
 * **That read is load-bearing.** It is the exact line a tidying pass deletes as a no-op with no
 * assignment, after which the pill bumps the first time and never again, and nobody attributes
 * it to a commit three weeks earlier. `el.test.ts` counts the reflow so that deleting the line
 * fails a test rather than a player's second collect.
 *
 * Pass `''` to disable — a caller that has no bump animation should not pay a forced layout.
 */
export function pulse(node: HTMLElement, className = 'bump'): void {
  if (className === '') return;
  node.classList.remove(className);
  void node.offsetWidth; // load-bearing: forces layout so the removal above is observed
  node.classList.add(className);
}

/**
 * Grant pointer events to this node and its subtree, inline. **The only way in.**
 *
 * The overlay root is `pointer-events: none` and this package ships no stylesheet, so there is
 * no `#ui > *` rule for a game's own `.spacer { pointer-events: none }` to lose a specificity
 * fight against. That fight is trap 1 and it cost the source game real time: a full-width flex
 * spacer inherited `auto` from a descendant rule, and every tap on the ground behind it died on
 * an invisible div. Nothing on screen changed; the game simply stopped responding in the middle.
 *
 * If a tap should reach the world, do nothing. If it should not, name the node.
 */
export function interactive<T extends HTMLElement>(node: T): T {
  node.style.setProperty('pointer-events', 'auto');
  return node;
}

/**
 * Take pointer events away from a subtree of an interactive panel.
 *
 * For the decorative child that overlaps something tappable — a full-width header glow, a
 * gradient scrim inside a sheet, an absolutely-positioned badge. Without it the only remedy is a
 * stylesheet rule, and a stylesheet rule is how trap 1 starts.
 */
export function passthrough<T extends HTMLElement>(node: T): T {
  node.style.setProperty('pointer-events', 'none');
  return node;
}
