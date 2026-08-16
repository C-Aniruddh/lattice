/**
 * A hand-rolled DOM, small enough to read in one sitting. Not a test file.
 *
 * The kit ships with zero dependencies and the tooling holds itself to the same standard, so
 * there is no jsdom here. What the adapter actually needs is narrow — `addEventListener`, a
 * rect, a style map, pointer capture and a computed style — and modeling exactly that has a
 * second benefit: everything this fake does **not** do is a thing the adapter is not allowed to
 * rely on.
 *
 * The one piece of real DOM semantics worth modeling is capture-phase propagation, because the
 * `covered-by-overlay` diagnostic is built on it: a `pointerdown` delivered to something on top
 * of the world still runs the document's capture listener first, with `target` set to whatever
 * was actually hit.
 */

interface Listener {
  readonly fn: (event: unknown) => void;
  readonly capture: boolean;
}

/** `addEventListener`/`removeEventListener`, and a way to fire. */
export class FakeTarget {
  readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, fn: (event: unknown) => void, options?: unknown): void {
    const capture =
      options === true ||
      (typeof options === 'object' && options !== null && 'capture' in options
        ? (options as { capture?: boolean }).capture === true
        : false);
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, capture });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    const at = list.findIndex((l) => l.fn === fn);
    if (at >= 0) list.splice(at, 1);
  }

  /** How many listeners are bound, for the "dispose leaves nothing behind" assertion. */
  get bound(): number {
    let n = 0;
    for (const list of this.listeners.values()) n += list.length;
    return n;
  }

  run(type: string, event: unknown, capturePhase: boolean): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (listener.capture === capturePhase) listener.fn(event);
    }
  }
}

/** A CSS declaration as a map, which is all the adapter reads or writes. */
export class FakeStyle {
  private readonly values = new Map<string, string>();
  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.values.get(name) ?? '';
  }
  removeProperty(name: string): void {
    this.values.delete(name);
  }
  /** What a test asserts against after dispose. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

/** An element: a target, a style, a rect, and pointer capture. */
export class FakeElement extends FakeTarget {
  readonly style = new FakeStyle();
  readonly tagName: string;
  isContentEditable = false;
  rect = { left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 };
  /** Pointer ids currently captured, so a test can assert every one is released. */
  readonly captured = new Set<number>();
  /** Set to make `setPointerCapture` throw, as it does for a pointer already gone. */
  refuseCapture = false;
  readonly children: FakeElement[] = [];
  ownerDocument: FakeDocument;
  rects = 0;

  constructor(doc: FakeDocument, tagName = 'CANVAS') {
    super();
    this.ownerDocument = doc;
    this.tagName = tagName;
  }

  getBoundingClientRect(): typeof this.rect {
    this.rects += 1;
    return this.rect;
  }

  setPointerCapture(id: number): void {
    if (this.refuseCapture) throw new Error('InvalidStateError');
    this.captured.add(id);
  }

  releasePointerCapture(id: number): void {
    if (!this.captured.delete(id)) throw new Error('NotFoundError');
  }

  contains(node: unknown): boolean {
    return node === this || this.children.includes(node as FakeElement);
  }
}

/** A document: a target, a visibility state, and a window. */
export class FakeDocument extends FakeTarget {
  visibilityState = 'visible';
  defaultView: FakeWindow | null = null;
}

/** A window: a target, `getComputedStyle`, and optionally a `ResizeObserver`. */
export class FakeWindow extends FakeTarget {
  /** What `getComputedStyle` reports, whatever the inline style says. */
  computed: Record<string, string> = { 'touch-action': 'none', 'pointer-events': 'auto' };
  /** Set to false to model a browser without `ResizeObserver`. */
  observers: FakeResizeObserver[] = [];
  hasResizeObserver = true;

  getComputedStyle(): { getPropertyValue(name: string): string } {
    const computed = this.computed;
    return {
      getPropertyValue: (name: string): string => computed[name] ?? '',
    };
  }

  get ResizeObserver(): typeof FakeResizeObserver | undefined {
    if (!this.hasResizeObserver) return undefined;
    const observers = this.observers;
    // A subclass that registers itself, so a test can fire a resize without reaching inside.
    return class extends FakeResizeObserver {
      constructor(callback: () => void) {
        super(callback);
        observers.push(this);
      }
    };
  }
}

/** Enough of `ResizeObserver` for the adapter: observe, disconnect, and a way to fire. */
export class FakeResizeObserver {
  readonly callback: () => void;
  observing: unknown = null;
  disconnected = false;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe(target: unknown): void {
    this.observing = target;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

/** A document, a window and a canvas, wired to each other. */
export interface FakeWorld {
  readonly doc: FakeDocument;
  readonly view: FakeWindow;
  readonly element: FakeElement;
  /**
   * Dispatch an event at a target, capture phase on the document first.
   *
   * `target` defaults to the element, which is what the browser reports for anything the
   * canvas actually received.
   */
  fire(type: string, init?: Record<string, unknown>, target?: unknown): void;
}

/** Build one. */
export function world(): FakeWorld {
  const doc = new FakeDocument();
  const view = new FakeWindow();
  doc.defaultView = view;
  const element = new FakeElement(doc);
  return {
    doc,
    view,
    element,
    fire(type, init = {}, target = element): void {
      const event = {
        target,
        preventDefault: (): void => {
          prevented.add(event);
        },
        ...init,
      };
      doc.run(type, event, true);
      view.run(type, event, true);
      if (target instanceof FakeTarget && target !== doc && target !== view) {
        target.run(type, event, false);
      }
      doc.run(type, event, false);
      view.run(type, event, false);
    },
  };
}

/** Events whose `preventDefault` was called, so a test can assert the wheel was consumed. */
export const prevented = new WeakSet<object>();
