/**
 * Where bindings are owned, and the only way to obtain one.
 *
 * **There is no free-function binder in this package.** A listener can only be created through
 * a scope, so an unowned listener is not a thing that can be constructed. That is the whole
 * answer to "what shape does a game hold so that tearing down a scene cannot leak half of it":
 * it holds a scope, not an array of disposers, because an array is a thing you can forget to
 * push to and a scope is not.
 *
 * The teardown vocabulary itself is `@latticekit/core`'s `Scope`. This module adds three things
 * on top of it and nothing else: the typed `on`/`onAction` surface, the dispatch order below,
 * and `own`, so that a scene has **one** teardown tree rather than one per package it happens
 * to use.
 *
 * ## The dispatch order, and why it is worth the insertion sort
 *
 * > Handlers run in registration order, scopes in creation order, and the camera controller
 * > runs after all of them.
 *
 * That last clause is the one games rely on: a handler can `claim()` a drag and steer a
 * placement ghost with it, and the camera will not also pan. Panning away from the site a
 * player is aiming at is never what anyone means. The first two clauses cost an insertion scan
 * per registration — which happens at scene setup, never per frame — and buy an order that is
 * the same on every run, which is what a replay needs and what "the second panel wins" would
 * not give.
 *
 * Pure: no DOM, no clock.
 */

import type { Disposer, Scope } from '@latticekit/core';
import type { ActionEvent, AnyActionHandler, GestureMap } from './events.js';

/**
 * One registered handler.
 *
 * `live` rather than removal-on-the-spot: a handler that disposes its own scope while it is
 * running would otherwise splice the array being walked and skip the handler after it. Dead
 * entries are compacted when the outermost dispatch finishes.
 */
interface Entry<H> {
  readonly scopeOrder: number;
  live: boolean;
  readonly handler: H;
}

/**
 * An ordered list of handlers that is safe to mutate while it is being walked.
 *
 * The two dangerous mutations are both closed here: a handler that unsubscribes (marked dead,
 * compacted afterwards) and a handler that subscribes (queued, inserted afterwards, and
 * therefore never run by the dispatch it was created during — which is what stops a handler
 * that re-registers itself from looping for ever).
 */
export class HandlerList<H> {
  private entries: Entry<H>[] = [];
  private pending: Entry<H>[] = [];
  private depth = 0;
  private dirty = false;
  /** Entries visible to the walk in progress. Captured by {@link begin}. */
  private walkCount = 0;

  /** How many entries this dispatch may visit. Valid between {@link begin} and {@link end}. */
  get count(): number {
    return this.walkCount;
  }

  /** Registered handlers not yet disposed. The leak assertion a test can watch. */
  get size(): number {
    let n = 0;
    for (const entry of this.entries) if (entry.live) n += 1;
    return n + this.pending.length;
  }

  /**
   * Insert a handler at its ordered position and return the disposer that removes it.
   *
   * Idempotent by contract, like every disposer in the kit: the second call does nothing, so an
   * error path where teardown runs twice does not remove somebody else's handler.
   */
  add(scopeOrder: number, handler: H): Disposer {
    const entry: Entry<H> = { scopeOrder, live: true, handler };
    if (this.depth > 0) this.pending.push(entry);
    else this.insert(entry);
    return (): void => {
      if (!entry.live) return;
      entry.live = false;
      if (this.depth > 0) this.dirty = true;
      else this.compact();
    };
  }

  /** Open a walk. Everything registered from here on is invisible until it closes. */
  begin(): void {
    this.depth += 1;
    if (this.depth === 1) this.walkCount = this.entries.length;
  }

  /** The entry at `index`, or `undefined` if it was disposed mid-walk. */
  at(index: number): H | undefined {
    const entry = this.entries[index];
    return entry !== undefined && entry.live ? entry.handler : undefined;
  }

  /** Close a walk, applying everything that happened during it. */
  end(): void {
    this.depth -= 1;
    if (this.depth > 0) return;
    if (this.dirty) {
      this.dirty = false;
      this.compact();
    }
    if (this.pending.length > 0) {
      for (const entry of this.pending) this.insert(entry);
      this.pending.length = 0;
    }
  }

  /** Scan back over the scopes created after this one. Registration is setup, never per frame. */
  private insert(entry: Entry<H>): void {
    let at = this.entries.length;
    while (at > 0) {
      const previous = this.entries[at - 1];
      if (previous === undefined || previous.scopeOrder <= entry.scopeOrder) break;
      at -= 1;
    }
    this.entries.splice(at, 0, entry);
  }

  private compact(): void {
    let write = 0;
    for (const entry of this.entries) {
      if (!entry.live) continue;
      this.entries[write] = entry;
      write += 1;
    }
    this.entries.length = write;
  }
}

/** Every gesture's handler list, each typed to the event its subscribers receive. */
export type GestureLists = {
  [K in keyof GestureMap]: HandlerList<(gesture: GestureMap[K]) => void>;
};

/** Build the six empty lists. One object per system, at construction. */
export function createGestureLists(): GestureLists {
  return {
    tap: new HandlerList(),
    longpress: new HandlerList(),
    dragstart: new HandlerList(),
    drag: new HandlerList(),
    dragend: new HandlerList(),
    zoom: new HandlerList(),
  };
}

/**
 * A place bindings are owned.
 *
 * Held by a scene, a screen, a modal — anything with a lifetime. Disposing it disposes every
 * binding made through it and every scope descended from it, in reverse registration order,
 * and disposing it twice does nothing.
 */
export interface InputScope<A extends string = never> {
  /** A child scope. Disposing the parent disposes it; disposing it does not touch the parent. */
  scope(): InputScope<A>;

  /**
   * Subscribe to a recognized gesture.
   *
   * Handlers run in registration order, scopes in creation order, and the camera controller
   * runs after all of them — so a handler can `claim()` a drag and steer a placement ghost with
   * it, and the camera will not also pan.
   *
   * @returns a disposer for this one binding. The scope owns it too; taking it is for the
   *   caller that wants to unbind early without tearing the scope down.
   */
  on<K extends keyof GestureMap>(type: K, handler: (gesture: GestureMap[K]) => void): Disposer;

  /**
   * Subscribe to a declared action, whichever device produced it.
   *
   * `action` is typed to the names declared in `InputOptions.actions`, so a renamed action
   * breaks the build rather than silently going quiet.
   *
   * @throws RangeError if the action was never declared. A JS caller misspelling one would
   *   otherwise register a handler that can never run, which looks exactly like a game bug.
   */
  onAction(action: A, handler: (event: ActionEvent<A>) => void): Disposer;

  /**
   * Hand this scope something else to unbind — an audio node, a `ResizeObserver`, a `ui` panel.
   *
   * Present so a scene has one teardown tree rather than one per package it happens to use.
   *
   * @throws TypeError if `disposer` is not a function, at the line that made the mistake rather
   *   than at teardown an hour later.
   */
  own(disposer: Disposer): Disposer;

  /** Dispose this scope and every scope descended from it. Safe to call during a drain. */
  dispose(): void;

  readonly disposed: boolean;
}

/** What a scope needs from the system it belongs to. The system implements this once. */
export interface ScopeHost<A extends string> {
  readonly gestures: GestureLists;
  /** Handler lists per declared action name, created when the map is compiled. */
  actionList(action: A): HandlerList<AnyActionHandler>;
  /** Creation order, shared across the whole tree so "scopes in creation order" is total. */
  nextScopeOrder(): number;
}

/**
 * Build a scope over a `core` scope.
 *
 * @param host The system's registries.
 * @param owner The `core` scope this one's bindings are registered into. The system passes its
 *   own; a child passes `owner.child()`, which is what makes disposal a tree.
 * @param order This scope's position in creation order.
 */
export function createInputScope<A extends string>(
  host: ScopeHost<A>,
  owner: Scope,
  order: number,
): InputScope<A> {
  const scope: InputScope<A> = {
    scope(): InputScope<A> {
      return createInputScope(host, owner.child(), host.nextScopeOrder());
    },

    on<K extends keyof GestureMap>(
      type: K,
      handler: (gesture: GestureMap[K]) => void,
    ): Disposer {
      const list = host.gestures[type];
      if (list === undefined) {
        throw new RangeError(
          `input.on: '${String(type)}' is not a gesture; expected one of tap, longpress, dragstart, drag, dragend, zoom`,
        );
      }
      return owner.add(list.add(order, handler));
    },

    onAction(action: A, handler: (event: ActionEvent<A>) => void): Disposer {
      // The one erasure in the package, and the reason it is safe is written on
      // `AnyActionHandler`: the registry looks a handler up by the very name it will find in
      // `event.action`, so the caller's narrowing is never a lie.
      const erased = handler as AnyActionHandler;
      return owner.add(host.actionList(action).add(order, erased));
    },

    own(disposer: Disposer): Disposer {
      return owner.add(disposer);
    },

    dispose(): void {
      owner.dispose();
    },

    get disposed(): boolean {
      return owner.disposed;
    },
  };
  return scope;
}
