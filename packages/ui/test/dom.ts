/**
 * A hand-written DOM double, for tests only.
 *
 * `@lattice/ui` is the kit's only browser package, and the kit has **no dependencies at all** —
 * not in `src`, not in `devDependencies`. Adding `jsdom` to run these tests would put a
 * 3 MB, 200-package tree behind a kit whose entire premise is that it installs in one `npm i`
 * with nothing transitive. So this file implements the subset of the platform the package
 * actually touches, in about three hundred lines, and every test in `packages/ui/test` runs in
 * the repo's default `node` environment.
 *
 * **What it proves and what it does not.** It proves everything this package *decides*: which
 * nodes exist, in which layer, in which order, with which classes and which inline properties;
 * which listener is bound to what; what is written and — the point of half these tests — what is
 * *not* written. It cannot prove CSS cascade or specificity, and no test in Node can. The design
 * is what answers those: this package ships no stylesheet, so there is no descendant rule to
 * lose a specificity fight against, and everything it writes is inline, which beats any author
 * rule that is not `!important`. `hide()` writes `!important` so that even that case is covered,
 * and `auditOverlay` is the runtime check for a game that adds a rule anyway.
 *
 * Deliberately unimplemented, so that a test cannot accidentally rely on it: layout (every box
 * is zero-sized), the cascade (`setComputed` states what a stylesheet *would have* produced),
 * and any element method this package never calls.
 */

/** A style declaration: property → value plus priority, in insertion order. */
class FakeStyle {
  readonly props = new Map<string, { value: string; priority: string }>();

  getPropertyValue(name: string): string {
    return this.props.get(name)?.value ?? '';
  }

  getPropertyPriority(name: string): string {
    return this.props.get(name)?.priority ?? '';
  }

  setProperty(name: string, value: string, priority = ''): void {
    this.props.set(name, { value, priority });
  }

  removeProperty(name: string): string {
    const found = this.props.get(name);
    this.props.delete(name);
    return found?.value ?? '';
  }
}

/** `classList`, backed by the element's `className` so the two can never disagree. */
class FakeClassList {
  constructor(private readonly owner: FakeElement) {}

  private parts(): string[] {
    return this.owner.className === '' ? [] : this.owner.className.trim().split(/\s+/);
  }

  contains(name: string): boolean {
    return this.parts().includes(name);
  }

  add(name: string): void {
    const parts = this.parts();
    if (!parts.includes(name)) {
      parts.push(name);
      this.owner.className = parts.join(' ');
    }
  }

  remove(name: string): void {
    this.owner.className = this.parts()
      .filter((part) => part !== name)
      .join(' ');
  }
}

/** An event, with the three fields this package reads. Bubbles by default, like the real ones
 *  this package binds (`click`, `keydown`); `pointerenter` / `pointerleave` do not. */
export class FakeEvent {
  defaultPrevented = false;
  target: FakeNode | null = null;

  constructor(
    readonly type: string,
    readonly init: { key?: string; shiftKey?: boolean; bubbles?: boolean } = {},
  ) {}

  get key(): string {
    return this.init.key ?? '';
  }

  get shiftKey(): boolean {
    return this.init.shiftKey ?? false;
  }

  get bubbles(): boolean {
    return this.init.bubbles ?? true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

/** A Web Animation, recorded rather than run. Enough for the two things this package does with
 *  one: pause it while a pointer rests on a toast, and cancel it when a node is recycled. */
export class FakeAnimation {
  state: 'running' | 'paused' | 'canceled' | 'finished' = 'running';

  constructor(
    readonly keyframes: unknown,
    readonly options: unknown,
  ) {}

  pause(): void {
    this.state = 'paused';
  }

  play(): void {
    this.state = 'running';
  }

  cancel(): void {
    this.state = 'canceled';
  }
}

/** The shared half of an element and a text node. */
export class FakeNode {
  parentNode: FakeElement | null = null;
  ownerDocument: FakeDocument;

  constructor(doc: FakeDocument) {
    this.ownerDocument = doc;
  }
}

/** A text node. `textContent` is the only thing anything asks it for. */
export class FakeText extends FakeNode {
  constructor(
    doc: FakeDocument,
    public data: string,
  ) {
    super(doc);
  }

  get textContent(): string {
    return this.data;
  }

  set textContent(value: string) {
    this.data = value;
    this.ownerDocument.textWrites += 1;
  }
}

/** An element. */
export class FakeElement extends FakeNode {
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList(this);
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  /** What a stylesheet would have produced, stated by the test. Consulted only where the inline
   *  style is silent, which is exactly the cascade rule that matters to `auditOverlay`. */
  readonly computed = new Map<string, string>();
  readonly animations: FakeAnimation[] = [];
  className = '';
  constructor(
    doc: FakeDocument,
    readonly tagName: string,
  ) {
    super(doc);
    // A host without Web Animations — older Safari, a reduced-motion embed — is a real
    // configuration, and this package must still expire a toast and recycle a float there.
    // An own property shadows the prototype method, which is what `typeof node.animate` reads.
    if (!doc.animations) Object.defineProperty(this, 'animate', { value: undefined });
  }

  get children(): {
    readonly length: number;
    item(i: number): FakeElement | null;
    [Symbol.iterator](): IterableIterator<FakeElement>;
  } {
    const kids = this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
    return {
      length: kids.length,
      item: (i: number) => kids[i] ?? null,
      [Symbol.iterator]: () => kids[Symbol.iterator](),
    };
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get offsetWidth(): number {
    this.ownerDocument.reflows += 1;
    return 0;
  }

  get textContent(): string {
    let out = '';
    for (const child of this.childNodes) {
      if (child instanceof FakeText) out += child.data;
      else if (child instanceof FakeElement) out += child.textContent;
    }
    return out;
  }

  set textContent(value: string) {
    this.childNodes.length = 0;
    this.ownerDocument.textWrites += 1;
    if (value !== '') this.appendChild(new FakeText(this.ownerDocument, value));
  }

  appendChild<T extends FakeNode>(child: T): T {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild<T extends FakeNode>(child: T): T {
    const at = this.childNodes.indexOf(child);
    if (at !== -1) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, fn: (event: FakeEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event: FakeEvent) => void>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (event: FakeEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Dispatch, then bubble to the ancestors — the real propagation this package relies on for a
   *  keydown inside a dialog and a click on a button inside a toast. */
  dispatchEvent(event: FakeEvent): boolean {
    event.target ??= this;
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event);
    if (event.bubbles && this.parentNode !== null) this.parentNode.dispatchEvent(event);
    else if (event.bubbles) this.ownerDocument.bubble(event);
    return !event.defaultPrevented;
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  animate(keyframes: unknown, options: unknown): FakeAnimation {
    const anim = new FakeAnimation(keyframes, options);
    this.animations.push(anim);
    return anim;
  }

  /** Every element in this subtree, self first. Test-only; nothing in `src` walks like this. */
  descendants(): FakeElement[] {
    const out: FakeElement[] = [this];
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) out.push(...child.descendants());
    }
    return out;
  }
}

/** A `<canvas>`: a real element plus the two members `@lattice/draw` needs from one. */
export class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;
  /** Every 2D call `draw` made, in order. A recording rather than a raster: these tests assert
   *  that a thumbnail was painted **once**, not what it looks like. */
  readonly calls: string[] = [];

  getContext(kind: string): object | null {
    if (kind !== '2d') return null;
    const calls = this.calls;
    // Every property is a no-op function and every unknown read is `undefined`; `draw`'s
    // canvas backend sets state and issues draw calls and reads nothing back at this level.
    return new Proxy(
      {},
      {
        get(_target, prop: string | symbol) {
          if (typeof prop !== 'string') return undefined;
          return (...args: unknown[]) => {
            calls.push(`${prop}(${args.length.toString()})`);
            return undefined;
          };
        },
        set(_target, prop: string | symbol) {
          if (typeof prop === 'string') calls.push(`set ${prop}`);
          return true;
        },
      },
    );
  }

  toDataURL(): string {
    return `data:image/png;fake,${String(this.width)}x${String(this.height)}#${String(this.calls.length)}`;
  }
}

/** The document. */
export class FakeDocument {
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  visibilityState: 'visible' | 'hidden' = 'visible';
  readonly listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  /** How many elements have been created through this document. Invariant 9 — "`spawn`
   *  allocates nothing after warm-up" — is this number not moving. */
  created = 0;
  /** How many times any node's `textContent` was written. Invariant 13 is this number. */
  textWrites = 0;
  /** Whether elements from this document have `animate`. Set to false to stand in for a host
   *  with no Web Animations. */
  animations = true;
  /** How many times `offsetWidth` was read anywhere. `pulse()` reads it once to force a layout,
   *  and that read is the load-bearing line a tidying pass deletes as a no-op. */
  reflows = 0;

  constructor() {
    this.body = new FakeElement(this, 'BODY');
  }

  createElement(tag: string): FakeElement {
    this.created += 1;
    const upper = tag.toUpperCase();
    return upper === 'CANVAS' ? new FakeCanvas(this, upper) : new FakeElement(this, upper);
  }

  createTextNode(data: string): FakeText {
    return new FakeText(this, data);
  }

  addEventListener(type: string, fn: (event: FakeEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set<(event: FakeEvent) => void>();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (event: FakeEvent) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Deliver an event that bubbled off the top of the tree, or one dispatched at the document
   *  itself — which is where this package's `keydown` and `visibilitychange` listeners live. */
  bubble(event: FakeEvent): void {
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event);
  }

  dispatchEvent(event: FakeEvent): boolean {
    event.target ??= null;
    this.bubble(event);
    return !event.defaultPrevented;
  }

  /** How many listeners are bound to the document. Invariant 10 — everything is disposable —
   *  is this number returning to what it was. */
  get listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  get defaultView(): { getComputedStyle(node: FakeElement): FakeStyle } {
    return {
      getComputedStyle(node: FakeElement): FakeStyle {
        const merged = new FakeStyle();
        // The cascade, as much of it as matters here: a stylesheet value the test stated, then
        // the inline value on top of it. Inline winning is the mechanism the package relies on.
        for (const [prop, value] of node.computed) merged.setProperty(prop, value);
        for (const [prop, entry] of node.style.props) merged.setProperty(prop, entry.value);
        return merged;
      },
    };
  }
}

/** A handle on an installed fake environment. */
export interface DomHandle {
  /** The document `@lattice/ui` will build into. */
  readonly doc: FakeDocument;
  /** Calls to `setInterval`. Invariant 3 — a default overlay starts no clock — is this being 0. */
  intervals: number;
  /** Calls to `requestAnimationFrame`. Also 0 for a default overlay. */
  frames: number;
  /** Run every pending interval callback once. */
  fireInterval(): void;
  /** Run the pending frame callback once. */
  fireFrame(): void;
  /** How many interval and frame handles are still live. Invariant 10 is this reaching 0. */
  liveTimers(): number;
  /** Put the globals back exactly as they were. */
  restore(): void;
}

/**
 * Install a fake `document`, timers and `devicePixelRatio` on `globalThis`, and hand back the
 * handle a test drives them through.
 *
 * The globals are restored by `restore()` rather than left behind, because a test file that
 * leaks a `document` into the next one turns a Node-only kit green for the wrong reason.
 */
export function installDom(dpr = 1): DomHandle {
  const doc = new FakeDocument();
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const intervalFns = new Map<number, () => void>();
  const frameFns = new Map<number, () => void>();
  let nextId = 1;

  const handle: DomHandle = {
    doc,
    intervals: 0,
    frames: 0,
    fireInterval(): void {
      for (const fn of [...intervalFns.values()]) fn();
    },
    fireFrame(): void {
      for (const [id, fn] of [...frameFns]) {
        frameFns.delete(id);
        fn();
      }
    },
    liveTimers(): number {
      return intervalFns.size + frameFns.size;
    },
    restore(): void {
      for (const [name, descriptor] of previous) {
        if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name];
        else Object.defineProperty(globalThis, name, descriptor);
      }
    },
  };

  const define = (name: string, value: unknown): void => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  define('document', doc);
  define('devicePixelRatio', dpr);
  define('setInterval', (fn: () => void) => {
    handle.intervals += 1;
    const id = nextId++;
    intervalFns.set(id, fn);
    return id;
  });
  define('clearInterval', (id: number) => intervalFns.delete(id));
  define('requestAnimationFrame', (fn: () => void) => {
    handle.frames += 1;
    const id = nextId++;
    frameFns.set(id, fn);
    return id;
  });
  define('cancelAnimationFrame', (id: number) => frameFns.delete(id));

  return handle;
}

/** A clock a test drives by hand. Time is a parameter everywhere in this kit; this is the
 *  parameter. */
export function fakeClock(start = 0): { now: () => number; set(value: number): void } {
  let value = start;
  return {
    now: () => value,
    set(next: number): void {
      value = next;
    },
  };
}
