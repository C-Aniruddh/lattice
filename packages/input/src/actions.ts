/**
 * The action map: two sources under one name, declared as data.
 *
 * A game writes `onAction('collect', …)` **once**. A tap reaches it through the gesture
 * recognizer carrying the finger's tile; `key:Space` reaches it through the keyboard carrying
 * the focus point's tile; both arrive as the same event, in the same tick. The only things a
 * handler can tell them apart by are `source` and `binding`, and it is free to ignore both —
 * which is the test of whether the abstraction is real rather than decorative.
 *
 * **The names are inferred from the map object**, so `onAction('colect', …)` is a compile
 * error rather than a handler that silently never runs. A third source is one more string in
 * an array, and still no second handler.
 *
 * **Actions fire on the press edge only, once per physical press.** Auto-repeat does not fire
 * them: the repeat rate is an operating-system accessibility setting, so an action that repeats
 * is an action whose count is not reproducible — and a log that does not reproduce is not a
 * log. A held action is a query ({@link CompiledActions.held}), not a stream.
 *
 * Pure: no DOM, no clock.
 */

import type { Diagnostic, DiagnosticSink } from './sample.js';

/**
 * One way of producing an action.
 *
 * `key:` takes a `KeyboardEvent.code` — a physical position, not a letter — so WASD stays under
 * the same four fingers on AZERTY.
 *
 * Only `tap` and `longpress` appear here, out of six gestures. An action must mean the same
 * thing from every device that can produce it, and a drag has no keyboard equivalent that is
 * not a lie. A `` `pad:${PadButton}` `` member is the intended shape of the third source when
 * it returns; adding a member to this union breaks nothing.
 */
export type ActionBinding = 'tap' | 'longpress' | `key:${string}`;

/**
 * The declared map, from which the action names are inferred.
 *
 * A mapped type rather than `Record<string, …>`, because `Record<string, …>` would infer `A`
 * as `string` and every misspelling would type-check.
 */
export type ActionMap<A extends string> = { readonly [K in A]: readonly ActionBinding[] };

/** One binding of one action, resolved once at build time so dispatch allocates nothing. */
export interface ActionEntry<A extends string> {
  readonly action: A;
  readonly binding: ActionBinding;
}

/** The action map, compiled: name lists, and one lookup per source kind. */
export interface CompiledActions<A extends string> {
  /** Every declared action, in declaration order. */
  readonly names: readonly A[];
  /**
   * What is bound to an action.
   *
   * Exists so a keyboard-shortcut sheet is rendered *from* the map. In the source game an
   * entire test file existed to catch a sheet that promised keys nothing handled, and a sheet
   * nobody could find for keys that worked. Generated from this, that defect class cannot occur.
   *
   * @throws RangeError naming the unknown action and listing the declared ones. Returning an
   *   empty array instead would render a shortcut sheet with a silently missing row.
   */
  bindings(action: A): readonly ActionBinding[];
  /** Actions bound to `tap` or `longpress`, in declaration order. Empty array if none. */
  forGesture(type: 'tap' | 'longpress'): readonly ActionEntry<A>[];
  /** Actions bound to this `KeyboardEvent.code`, in declaration order. Empty array if none. */
  forKey(code: string): readonly ActionEntry<A>[];
  /** Is any binding of this action currently held? */
  held(action: A, pressed: boolean, isKeyHeld: (code: string) => boolean): boolean;
}

/** Nothing declared. One shared instance, because a game with no actions still has a system. */
const NO_ENTRIES: readonly ActionEntry<never>[] = [];

/**
 * The refusal every entry point keyed by an action name shares.
 *
 * One function rather than the same sentence typed at four call sites, because the value of the
 * message is the list of names it prints and a copy that forgets to print them is the version
 * somebody writes when they add the fifth entry point. `fn` is the method the game called, so
 * the message names `input.held` rather than this file.
 */
export function undeclared(fn: string, action: string, names: readonly string[]): RangeError {
  return new RangeError(`${fn}: '${action}' is not a declared action; declared: ${nameList(names)}`);
}

/**
 * The declared names as a reader sees them, or `(none)`.
 *
 * A game with no actions at all is legal, and printing an empty string there produces a message
 * that trails off mid-sentence — which reads like the error itself is broken.
 */
export function nameList(names: readonly string[]): string {
  return names.length === 0 ? '(none)' : names.join(', ');
}

/**
 * Every `KeyboardEvent.code` this build recognizes.
 *
 * Built rather than typed out, because a hand-written list of 26 letters is a list with a typo
 * in it. The table exists to catch `'key:space'` — a `key` value where a `code` was wanted,
 * which binds nothing and goes quiet — and **not** to be exhaustive: a code that is not here
 * and does not look like a near miss is still bound, with a diagnostic, because refusing
 * `IntlYen` on a Japanese keyboard would be worse than the mistake this guards against.
 */
const KNOWN_CODES: ReadonlySet<string> = buildKnownCodes();

function buildKnownCodes(): ReadonlySet<string> {
  const codes = new Set<string>();
  for (let i = 0; i < 26; i++) codes.add(`Key${String.fromCharCode(65 + i)}`);
  for (let i = 0; i < 10; i++) {
    codes.add(`Digit${String(i)}`);
    codes.add(`Numpad${String(i)}`);
  }
  for (let i = 1; i <= 20; i++) codes.add(`F${String(i)}`);
  for (const side of ['Left', 'Right']) {
    codes.add(`Shift${side}`);
    codes.add(`Control${side}`);
    codes.add(`Alt${side}`);
    codes.add(`Meta${side}`);
  }
  for (const code of [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert',
    'Home', 'End', 'PageUp', 'PageDown', 'CapsLock', 'ContextMenu',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon',
    'Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'IntlBackslash',
    'NumLock', 'ScrollLock', 'Pause', 'PrintScreen',
    'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide',
    'NumpadDecimal', 'NumpadEnter', 'NumpadEqual',
  ]) {
    codes.add(code);
  }
  return codes;
}

/**
 * The code a caller probably meant, or `undefined` if there is no near miss.
 *
 * Three near misses are worth naming, and they are the three people actually write: the wrong
 * case (`space`), the character instead of the code (`b`), and the digit instead of the code
 * (`5`). Anything further away is not a typo, it is a code from a keyboard this table does not
 * list, and guessing at it would send the caller looking for a bug they do not have.
 */
export function suggestCode(code: string): string | undefined {
  const lower = code.toLowerCase();
  for (const known of KNOWN_CODES) if (known.toLowerCase() === lower) return known;
  if (code.length === 1) {
    const letter = `Key${code.toUpperCase()}`;
    if (KNOWN_CODES.has(letter)) return letter;
    const digit = `Digit${code}`;
    if (KNOWN_CODES.has(digit)) return digit;
  }
  return undefined;
}

/**
 * Compile the declared map, rejecting what is certainly wrong and diagnosing what is merely
 * unknown.
 *
 * @param label Prefix for every error, so the message names the caller's option:
 *   `createInput.actions: …`.
 * @throws RangeError if a binding is not `tap`, `longpress` or `key:<code>`, if an action's
 *   binding list is empty, or if a `key:` code is a near miss for a real one — `'key:space'`
 *   reports `did you mean 'key:Space'?` rather than binding nothing and going quiet.
 */
export function compileActions<A extends string>(
  map: ActionMap<A> | undefined,
  label: string,
  diagnose: DiagnosticSink,
): CompiledActions<A> {
  const names: A[] = [];
  const byAction = new Map<string, readonly ActionBinding[]>();
  // Two arrays rather than a map keyed by the gesture name: there are exactly two gesture
  // bindings and there will only ever be two, so a lookup that can miss is a branch that can
  // never be taken and a reader has to satisfy themselves about anyway.
  const byTap: ActionEntry<A>[] = [];
  const byLongPress: ActionEntry<A>[] = [];
  const byKey = new Map<string, ActionEntry<A>[]>();

  if (map !== undefined) {
    for (const key of Object.keys(map)) {
      const action = key as A;
      const list = map[action];
      if (!Array.isArray(list)) {
        throw new RangeError(
          `${label}.${key}: expected an array of bindings, got ${String(list)} — an action with no way to fire it is a name nothing can produce`,
        );
      }
      if (list.length === 0) {
        throw new RangeError(
          `${label}.${key}: expected at least one binding — declare the action where it can fire, or delete it from the map`,
        );
      }
      names.push(action);
      byAction.set(action, [...list]);
      for (const binding of list) {
        const entry: ActionEntry<A> = { action, binding };
        if (binding === 'tap' || binding === 'longpress') {
          (binding === 'tap' ? byTap : byLongPress).push(entry);
          continue;
        }
        if (typeof binding !== 'string' || !binding.startsWith('key:')) {
          throw new RangeError(
            `${label}.${key}: expected 'tap', 'longpress' or 'key:<KeyboardEvent.code>', got ${JSON.stringify(binding)}`,
          );
        }
        const code = binding.slice(4);
        if (!KNOWN_CODES.has(code)) {
          const suggestion = suggestCode(code);
          if (suggestion !== undefined) {
            throw new RangeError(
              `${label}.${key}: '${binding}' is not a KeyboardEvent.code; did you mean 'key:${suggestion}'?`,
            );
          }
          const diagnostic: Diagnostic = {
            code: 'unknown-key-code',
            message: `${label}.${key}: '${binding}' is not a KeyboardEvent.code this build recognizes. It is still bound, because this table is not exhaustive — but check it against the codes your keyboard actually reports before shipping the shortcut sheet.`,
          };
          diagnose(diagnostic);
        }
        let list2 = byKey.get(code);
        if (list2 === undefined) {
          list2 = [];
          byKey.set(code, list2);
        }
        list2.push(entry);
      }
    }
  }

  return {
    names,

    bindings(action: A): readonly ActionBinding[] {
      const found = byAction.get(action);
      if (found === undefined) throw undeclared('input.bindings', String(action), names);
      return found;
    },

    forGesture(type: 'tap' | 'longpress'): readonly ActionEntry<A>[] {
      return type === 'tap' ? byTap : byLongPress;
    },

    forKey(code: string): readonly ActionEntry<A>[] {
      return byKey.get(code) ?? NO_ENTRIES;
    },

    held(action: A, pressed: boolean, isKeyHeld: (code: string) => boolean): boolean {
      const found = byAction.get(action);
      if (found === undefined) throw undeclared('input.held', String(action), names);
      for (const binding of found) {
        if (binding === 'tap' || binding === 'longpress') {
          if (pressed) return true;
          continue;
        }
        if (isKeyHeld(binding.slice(4))) return true;
      }
      return false;
    },
  };
}
