/**
 * A canvas and a 2D context that record instead of rasterising.
 *
 * `canvas2d.ts` is the one module in this package that touches the DOM, and it is therefore the
 * one module a Node suite cannot exercise directly. The alternative to this file is leaving the
 * browser backend untested — which is exactly the module where a state leak, a doubled device
 * ratio, or a composite left set would do the most damage and be hardest to see.
 *
 * It records *calls and state*, not pixels. That is the same choice `record.ts` makes for the
 * same reason: what is worth protecting here is whether the backend set `globalAlpha` back,
 * whether it reset the dash, and whether it applied the ratio once — none of which a pixel diff
 * would show.
 */

/** One recorded context call. */
export interface Call {
  /** The method name. */
  readonly fn: string;
  /** Its arguments, in order. */
  readonly args: readonly unknown[];
}

/** The context, plus the log and the state a test wants to look at. */
export interface FakeContext {
  /** Every call in order. */
  readonly calls: Call[];
  /** Property assignments in order, as `name=value`. */
  readonly sets: string[];
  /** Whatever `fillStyle` currently is. */
  fillStyle: unknown;
  /** Whatever `globalAlpha` currently is. */
  globalAlpha: number;
  /** Whatever `globalCompositeOperation` currently is. */
  globalCompositeOperation: string;
}

/** Names of every context method the backend is allowed to call. Anything outside this list is
 *  a method a real WebGL backend would have to emulate, so the list is the seam restated. */
const METHODS = [
  'setTransform',
  'clearRect',
  'fillRect',
  'beginPath',
  'moveTo',
  'lineTo',
  'closePath',
  'fill',
  'stroke',
  'ellipse',
  'setLineDash',
  'fillText',
  'drawImage',
  'createLinearGradient',
  'createRadialGradient',
  'measureText',
  'addColorStop',
] as const;

/** Property names the backend assigns to. */
const PROPERTIES = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineJoin',
  'lineCap',
  'lineDashOffset',
  'globalAlpha',
  'globalCompositeOperation',
  'font',
  'textAlign',
  'textBaseline',
] as const;

/** What a fake canvas element exposes, plus the context it hands back. */
export interface FakeCanvas {
  /** Backing store width in device pixels. */
  width: number;
  /** Backing store height in device pixels. */
  height: number;
  /** CSS width, as the DOM would report it for an element in the document. */
  clientWidth: number;
  /** CSS height. */
  clientHeight: number;
  /** The recording context. */
  readonly ctx: FakeContext;
  /** `null` makes `getContext` fail, so the error path is reachable. */
  contextAvailable: boolean;
  /** Every `toDataURL` call's arguments. */
  readonly urls: unknown[][];
  /** @internal DOM shape. */
  getContext(kind: string, opts?: unknown): FakeContext | null;
  /** @internal DOM shape. */
  toDataURL(type?: string, quality?: number): string;
}

/** Build one fake canvas. `contextAvailable: false` reproduces a canvas already claimed by
 *  `getContext('webgl')`, which is the condition the backend refuses by name. */
export function fakeCanvas(width = 400, height = 300): FakeCanvas {
  const calls: Call[] = [];
  const sets: string[] = [];
  const record = (fn: string, args: readonly unknown[]): void => void calls.push({ fn, args });

  const ctx: Record<string, unknown> = {
    calls,
    sets,
    measureText: (value: string): { width: number } => {
      record('measureText', [value]);
      return { width: value.length * 7 };
    },
    createLinearGradient: (...args: unknown[]): unknown => {
      record('createLinearGradient', args);
      return {
        addColorStop: (...stop: unknown[]): void => record('addColorStop', stop),
      };
    },
    createRadialGradient: (...args: unknown[]): unknown => {
      record('createRadialGradient', args);
      return {
        addColorStop: (...stop: unknown[]): void => record('addColorStop', stop),
      };
    },
  };
  for (const fn of METHODS) {
    if (ctx[fn] === undefined) ctx[fn] = (...args: unknown[]): void => record(fn, args);
  }
  for (const name of PROPERTIES) {
    let held: unknown = name === 'globalAlpha' ? 1 : '';
    Object.defineProperty(ctx, name, {
      get: () => held,
      set: (next: unknown) => {
        held = next;
        sets.push(`${name}=${String(next)}`);
      },
      enumerable: true,
    });
  }

  const urls: unknown[][] = [];
  const canvas: FakeCanvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    ctx: ctx as unknown as FakeContext,
    contextAvailable: true,
    urls,
    getContext(kind: string, opts?: unknown): FakeContext | null {
      record('getContext', [kind, opts]);
      return canvas.contextAvailable ? (ctx as unknown as FakeContext) : null;
    },
    toDataURL(type?: string, quality?: number): string {
      urls.push([type, quality]);
      return `data:${type ?? 'image/png'};base64,AAAA`;
    },
  };
  return canvas;
}

/** What {@link installDom} hands back so a test can put the globals back. */
export interface DomHandle {
  /** Every canvas the module under test asked the document to make, in order. */
  readonly created: FakeCanvas[];
  /** Restore whatever `document` and `window` were before. */
  restore(): void;
}

/**
 * Install just enough of a DOM for `canvas2d.ts` to run: a `document.createElement('canvas')`
 * and a `window.devicePixelRatio`.
 *
 * Deliberately minimal. A full DOM shim would make this suite a test of the shim, and the whole
 * argument for the `Surface` seam is that a backend needs very little from its host.
 */
export function installDom(devicePixelRatio = 1): DomHandle {
  const created: FakeCanvas[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const hadDocument = 'document' in globals;
  const hadWindow = 'window' in globals;
  const previousDocument = globals['document'];
  const previousWindow = globals['window'];

  globals['document'] = {
    createElement: (tag: string): FakeCanvas => {
      if (tag !== 'canvas') throw new Error(`fake document: only <canvas>, got <${tag}>`);
      const element = fakeCanvas(1, 1);
      created.push(element);
      return element;
    },
  };
  globals['window'] = { devicePixelRatio };

  return {
    created,
    restore(): void {
      if (hadDocument) globals['document'] = previousDocument;
      else delete globals['document'];
      if (hadWindow) globals['window'] = previousWindow;
      else delete globals['window'];
    },
  };
}
