/**
 * **`@browser-only`** — the gallery's control panel. A gallery instrument, never a kit feature.
 *
 * ```ts
 * controlPanel(boot, [knobs.voiceCeiling(audio), knobs.tapSlop(boot), knobs.offlineExponent(curve)]);
 * ```
 *
 * ## What it is for
 *
 * The kit is configurable and the configurability is invisible. That the zoom clamp, the day
 * length, the offline exponent, a light's radius and falloff, the voice ceiling and the
 * tap-versus-drag thresholds are all knobs lives in doc comments and RFC tables, which is to
 * say it lives nowhere a visitor will find it. A slider that moves a real parameter in a
 * running scene is better documentation than the paragraph describing it, and it costs one
 * shared module.
 *
 * **A control names the kit parameter it drives**, in `package Type.field` form, and the name is
 * rendered — so reading a panel tells you what the kit lets you change, and a control that
 * cannot name a real parameter has no business being here.
 *
 * ## The rule that makes it more than a nicety
 *
 * **Ship the knobs with a visible wrong end.** A slider that only ever looks fine teaches
 * nothing; a slider you can drag until the thing breaks teaches what the default was protecting
 * you from, which is knowledge currently buried in prose. So {@link Control.wrong} is a
 * first-class field: it draws the bad end onto the track in red and puts the consequence on
 * screen the moment you enter it. Push the voice ceiling to 2 and hear a burst choke; drag the
 * offline exponent to 1.0 and watch fourteen hours pay out uncapped; set the tap slop to 1 px
 * and discover you can no longer tap anything.
 *
 * ## Three constraints it is built against
 *
 * **It costs nothing per frame.** There is no loop subscription, no `requestAnimationFrame` and
 * no timer here. Every control is a native element built once; the only code that ever runs
 * again is an event handler on a value change. Fourteen exhibits will each carry this, and a
 * panel that cost a millisecond a frame would ruin the thing it is attached to. The optional
 * frame-time readout is the single exception, it is opt-in, and it unsubscribes when the panel
 * closes.
 *
 * **It is legible on a phone.** Bottom sheet, full width, 44 px targets, and it opens closed —
 * the first frame of an exhibit is its pitch and must not have a settings drawer over it.
 *
 * **It is built from native inputs on purpose.** `input`'s key handler already declines to turn
 * a keystroke into a game action when it is aimed at an `INPUT`, `TEXTAREA` or `SELECT`, so a
 * seed typed into this panel cannot also drive the world. A panel made of styled `<div>`s would
 * have had to reimplement that, and would have got it wrong on the exhibit that binds `KeyB`.
 */

import type { Params } from './params.js';

/** The root class. `bootstrap` looks for it when deciding whether a covered-world diagnostic is
 *  this panel legitimately sitting on top of the canvas. Renaming it breaks that filter. */
export const PANEL_CLASS = 'exhibit-panel';

/** Where a control's bad end is, and what happens when you get there. */
export interface Wrong {
  /** Values at or below this are the wrong end. */
  readonly below?: number;
  /** Values at or above this are the wrong end. */
  readonly above?: number;
  /** For a toggle or a choice: the value that is the wrong end. */
  readonly when?: boolean | string;
  /** One line, present tense, about what you are now looking at. Not a warning — a caption. */
  readonly says: string;
}

interface ControlBase {
  /** The URL key. Short, stable, and part of every shared link. */
  readonly key: string;
  /** What a visitor reads. Three or four words. */
  readonly label: string;
  /**
   * The kit parameter this drives, as `@latticekit/pkg Type.field`.
   *
   * Rendered under the label. It is the difference between a settings screen and a map of the
   * kit's own surface, and a control that cannot fill it in is exhibit plumbing rather than a
   * knob — which is the one thing this panel is not for.
   */
  readonly param: string;
  /** Optional second line of prose. The *why*, when the parameter name is not self-evident. */
  readonly note?: string;
  /**
   * When to call `apply`. Default `'input'` — live, on every movement.
   *
   * `'change'` waits for the release, and is **mandatory for anything whose apply rebuilds a
   * subsystem**: the voice ceiling closes and reopens an `AudioContext`, and browsers cap how
   * many one document may create, so a live drag exhausts the cap in about a second and the
   * exhibit goes permanently silent.
   */
  readonly commit?: 'input' | 'change';
}

/** A number on a track. The shape most kit parameters take. */
export interface RangeControl extends ControlBase {
  readonly kind: 'range';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value in force now. Read it off the live object, not off a constant. */
  readonly value: number;
  /** How the number is shown. Default: as written, with the step's precision. */
  readonly format?: (value: number) => string;
  readonly wrong?: Wrong;
  apply(value: number): void;
}

/** A boolean. */
export interface ToggleControl extends ControlBase {
  readonly kind: 'toggle';
  readonly value: boolean;
  readonly wrong?: Wrong;
  apply(value: boolean): void;
}

/** One of a short list. For an enum-shaped kit parameter — a tint slot, a wave name. */
export interface ChoiceControl extends ControlBase {
  readonly kind: 'choice';
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly wrong?: Wrong;
  apply(value: string): void;
}

/** Free text. The seed, and nothing else so far. */
export interface TextControl extends ControlBase {
  readonly kind: 'text';
  readonly value: string;
  readonly placeholder?: string;
  apply(value: string): void;
}

export type Control = RangeControl | ToggleControl | ChoiceControl | TextControl;

/** A control, or a heading that groups the ones after it. `null` is skipped, so an exhibit can
 *  write `audio === undefined ? null : knobs.voiceCeiling(audio)` inline. */
export type PanelEntry = Control | { readonly kind: 'group'; readonly label: string } | null;

export interface PanelOptions {
  /** The URL, so every value is in a shareable link. From `boot.params`. */
  readonly params: Params;
  /** Heading on the open sheet. The exhibit's name. */
  readonly title?: string;
  /** One line under it. What this exhibit is showing. */
  readonly subtitle?: string;
  /** Open on load. Default false — the first frame is the pitch, not the settings. */
  readonly open?: boolean;
  /** A source of frame time, sampled twice a second **only while the panel is open**. */
  readonly stats?: () => string;
}

export interface Panel {
  /** The root element, mounted on `<body>`. */
  readonly element: HTMLElement;
  /** Push a value in from outside — the exhibit changed it, not the visitor. */
  set(key: string, value: number | string | boolean): void;
  open(): void;
  close(): void;
  dispose(): void;
}

/** Injected once per document, not once per panel. */
let styled = false;

/**
 * The whole stylesheet. Near-black, monospace, no ornament — the landing page's chrome rule,
 * applied to the one piece of chrome an exhibit has.
 */
const CSS = `
.${PANEL_CLASS}{position:fixed;right:0;bottom:0;z-index:40;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cdd4e4;touch-action:manipulation;-webkit-font-smoothing:antialiased}
.${PANEL_CLASS} *{box-sizing:border-box}
.${PANEL_CLASS}-row>label,.${PANEL_CLASS}-param,.${PANEL_CLASS}-note,.${PANEL_CLASS}-group,.${PANEL_CLASS}-says,.${PANEL_CLASS}-tab{-webkit-user-select:none;user-select:none}
.${PANEL_CLASS}-tab{display:flex;align-items:center;gap:6px;margin:0 12px 12px auto;min-height:34px;padding:0 12px;border:1px solid #2b3350;border-radius:17px;background:#0d1120e6;color:#9aa6c4;font:inherit;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;backdrop-filter:blur(6px)}
.${PANEL_CLASS}-tab:hover{color:#e6ecff;border-color:#4a577f}
.${PANEL_CLASS}-tab b{font-weight:400;color:#5f6c93;text-transform:none;letter-spacing:0}
.${PANEL_CLASS}-sheet{display:none;width:min(340px,100vw);max-height:min(72vh,640px);overflow-y:auto;overscroll-behavior:contain;border-top:1px solid #2b3350;border-left:1px solid #2b3350;background:#080b14f2;backdrop-filter:blur(10px);padding:14px 14px calc(14px + env(safe-area-inset-bottom))}
.${PANEL_CLASS}[data-open="1"] .${PANEL_CLASS}-sheet{display:block}
.${PANEL_CLASS}[data-open="1"] .${PANEL_CLASS}-tab{margin-bottom:6px}
.${PANEL_CLASS}-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:2px}
.${PANEL_CLASS}-head h2{margin:0;font:inherit;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#e6ecff}
.${PANEL_CLASS}-head span{color:#5f6c93;font-variant-numeric:tabular-nums}
.${PANEL_CLASS}-sub{margin:0 0 12px;color:#6b78a0}
.${PANEL_CLASS}-group{margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #1b2137;color:#7f8cb4;letter-spacing:.12em;text-transform:uppercase}
.${PANEL_CLASS}-group:first-child{margin-top:4px}
.${PANEL_CLASS}-row{margin:0 0 13px}
.${PANEL_CLASS}-row>label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;cursor:pointer}
.${PANEL_CLASS}-row .n{color:#dbe2f4}
.${PANEL_CLASS}-row .v{color:#7fd4c8;font-variant-numeric:tabular-nums}
.${PANEL_CLASS}-row[data-wrong="1"] .v{color:#f0714f}
.${PANEL_CLASS}-param{display:block;margin:1px 0 5px;font-size:10px;color:#4e5a80;word-break:break-all}
.${PANEL_CLASS}-note{display:block;margin:-2px 0 5px;font-size:10px;color:#6b78a0}
.${PANEL_CLASS}-track{position:relative;height:20px}
.${PANEL_CLASS}-bad{position:absolute;top:9px;height:2px;background:#f0714f;opacity:.5;pointer-events:none;border-radius:1px}
.${PANEL_CLASS} input[type=range]{position:relative;width:100%;height:20px;margin:0;background:none;-webkit-appearance:none;appearance:none;touch-action:none;cursor:ew-resize}
.${PANEL_CLASS} input[type=range]::-webkit-slider-runnable-track{height:2px;border-radius:1px;background:#2b3350}
.${PANEL_CLASS} input[type=range]::-moz-range-track{height:2px;border-radius:1px;background:#2b3350}
.${PANEL_CLASS} input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-7px;border:0;border-radius:50%;background:#7fd4c8}
.${PANEL_CLASS} input[type=range]::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:#7fd4c8}
.${PANEL_CLASS}-row[data-wrong="1"] input[type=range]::-webkit-slider-thumb{background:#f0714f}
.${PANEL_CLASS}-row[data-wrong="1"] input[type=range]::-moz-range-thumb{background:#f0714f}
.${PANEL_CLASS} input[type=text],.${PANEL_CLASS} select{width:100%;height:30px;padding:0 8px;border:1px solid #2b3350;border-radius:4px;background:#0d1120;color:#dbe2f4;font:inherit}
.${PANEL_CLASS} input[type=checkbox]{width:34px;height:20px;margin:0;flex:none;-webkit-appearance:none;appearance:none;border:1px solid #2b3350;border-radius:10px;background:#0d1120;position:relative;cursor:pointer}
.${PANEL_CLASS} input[type=checkbox]::after{content:"";position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:#5f6c93;transition:transform .12s,background .12s}
.${PANEL_CLASS} input[type=checkbox]:checked{border-color:#7fd4c8}
.${PANEL_CLASS} input[type=checkbox]:checked::after{transform:translateX(14px);background:#7fd4c8}
.${PANEL_CLASS} :focus-visible{outline:1px solid #7fd4c8;outline-offset:2px}
.${PANEL_CLASS}-says{display:none;margin-top:5px;padding:5px 7px;border-left:2px solid #f0714f;background:#f0714f1a;color:#f0a48c;font-size:10px}
.${PANEL_CLASS}-row[data-wrong="1"] .${PANEL_CLASS}-says{display:block}
.${PANEL_CLASS}-foot{margin-top:14px;padding-top:9px;border-top:1px solid #1b2137;color:#4e5a80;font-size:10px}
@media (max-width:560px){
.${PANEL_CLASS}-sheet{width:100vw;max-height:58vh;border-left:0}
.${PANEL_CLASS}-tab{margin-right:10px;min-height:40px;padding:0 16px}
.${PANEL_CLASS}-row{margin-bottom:16px}
.${PANEL_CLASS} input[type=range]{height:28px}
.${PANEL_CLASS} input[type=range]::-webkit-slider-thumb{width:22px;height:22px;margin-top:-10px}
.${PANEL_CLASS} input[type=range]::-moz-range-thumb{width:22px;height:22px}
.${PANEL_CLASS}-track{height:28px}
.${PANEL_CLASS}-bad{top:13px}
}
@media (prefers-reduced-motion:reduce){.${PANEL_CLASS} input[type=checkbox]::after{transition:none}}
`;

function ensureStyle(): void {
  if (styled) return;
  styled = true;
  const tag = document.createElement('style');
  tag.textContent = CSS;
  document.head.append(tag);
}

/** Decimal places implied by a step, so `0.05` renders `0.60` and not `0.6000000000000001`. */
function placesOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** Is this value in the control's wrong end? */
function isWrong(wrong: Wrong | undefined, value: number | string | boolean): boolean {
  if (wrong === undefined) return false;
  if (wrong.when !== undefined) return value === wrong.when;
  if (typeof value !== 'number') return false;
  if (wrong.below !== undefined && value <= wrong.below) return true;
  return wrong.above !== undefined && value >= wrong.above;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Build the panel and mount it.
 *
 * Every control's `apply` runs **once, immediately**, with the value the URL asked for — so a
 * shared link is in force before the first frame rather than one frame after it. That is also
 * why a control's `value` must be read off the live object: it is both the initial state and
 * the thing the URL overrides.
 */
export function controlPanel(entries: readonly PanelEntry[], options: PanelOptions): Panel {
  ensureStyle();
  const { params } = options;

  const root = element('div', PANEL_CLASS);
  root.dataset['open'] = options.open === true ? '1' : '0';

  const tab = element('button', `${PANEL_CLASS}-tab`);
  tab.type = 'button';
  tab.setAttribute('aria-expanded', String(options.open === true));
  const tabText = element('span', undefined, 'knobs');
  const tabStat = element('b');
  tab.append(tabText, tabStat);

  const sheet = element('div', `${PANEL_CLASS}-sheet`);
  const head = element('div', `${PANEL_CLASS}-head`);
  head.append(element('h2', undefined, options.title ?? 'Controls'));
  const headCount = element('span');
  head.append(headCount);
  sheet.append(head);
  if (options.subtitle !== undefined) {
    sheet.append(element('p', `${PANEL_CLASS}-sub`, options.subtitle));
  }

  /** `key → set the widget from outside`, for {@link Panel.set}. */
  const setters = new Map<string, (value: number | string | boolean) => void>();
  let count = 0;

  for (const entry of entries) {
    if (entry === null) continue;
    if (entry.kind === 'group') {
      sheet.append(element('div', `${PANEL_CLASS}-group`, entry.label));
      continue;
    }
    count += 1;
    sheet.append(buildRow(entry, params, setters));
  }

  headCount.textContent = `${String(count)} params`;
  const foot = element('div', `${PANEL_CLASS}-foot`);
  foot.textContent = 'Every value above is in the URL. Copy the address bar to share this exact configuration.';
  sheet.append(foot);

  root.append(tab, sheet);
  document.body.append(root);

  // ── the one thing here that ever runs on a schedule ──────────────────────────────────────
  //
  // Twice a second, and only while the sheet is open. `setInterval` rather than a loop hook
  // deliberately: a frame-time readout that is itself sampled per frame is measuring its own
  // cost, and this panel's whole claim is that it has none.
  let statTimer: ReturnType<typeof setInterval> | undefined;
  const stats = options.stats;

  function pollStats(): void {
    if (stats === undefined) return;
    tabStat.textContent = stats();
  }

  function setOpen(open: boolean): void {
    root.dataset['open'] = open ? '1' : '0';
    tab.setAttribute('aria-expanded', String(open));
    if (open && stats !== undefined && statTimer === undefined) {
      pollStats();
      statTimer = setInterval(pollStats, 500);
    } else if (!open && statTimer !== undefined) {
      clearInterval(statTimer);
      statTimer = undefined;
      tabStat.textContent = '';
    }
  }

  tab.addEventListener('click', () => {
    setOpen(root.dataset['open'] !== '1');
  });
  if (options.open === true) setOpen(true);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && root.dataset['open'] === '1') setOpen(false);
  };
  addEventListener('keydown', onKey);

  return {
    element: root,
    set(key, value) {
      setters.get(key)?.(value);
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    dispose() {
      removeEventListener('keydown', onKey);
      if (statTimer !== undefined) clearInterval(statTimer);
      root.remove();
    },
  };
}

/**
 * One row.
 *
 * The URL is read here rather than by the caller so that a control declares its default once —
 * as `value` — and cannot end up with a different one in the address bar than in the scene.
 */
function buildRow(
  control: Control,
  params: Params,
  setters: Map<string, (value: number | string | boolean) => void>,
): HTMLElement {
  const row = element('div', `${PANEL_CLASS}-row`);
  const label = element('label');
  const name = element('span', 'n', control.label);
  const shown = element('span', 'v');
  label.append(name);

  const id = `k-${control.key}`;
  // Read before any narrowing: `TextControl` has no `wrong`, and the marker closure is shared.
  const wrong = control.kind === 'text' ? undefined : control.wrong;

  /** Repaint the row's wrong-end state. The only DOM work that ever repeats. */
  const mark = (value: number | string | boolean): void => {
    row.dataset['wrong'] = isWrong(wrong, value) ? '1' : '0';
  };

  if (control.kind === 'range') {
    const initial = control.value;
    const places = placesOf(control.step);
    const format = control.format ?? ((v: number): string => v.toFixed(places));
    const value = Math.min(control.max, Math.max(control.min, params.num(control.key, initial)));

    const input = element('input');
    input.type = 'range';
    input.id = id;
    input.min = String(control.min);
    input.max = String(control.max);
    input.step = String(control.step);
    input.value = String(value);
    label.htmlFor = id;
    shown.textContent = format(value);
    label.append(shown);

    const track = element('div', `${PANEL_CLASS}-track`);
    const span = control.max - control.min;
    if (control.wrong !== undefined && span > 0) {
      const bad = element('div', `${PANEL_CLASS}-bad`);
      if (control.wrong.below !== undefined) {
        bad.style.left = '0';
        bad.style.width = `${String((100 * (control.wrong.below - control.min)) / span)}%`;
      } else if (control.wrong.above !== undefined) {
        const at = (100 * (control.wrong.above - control.min)) / span;
        bad.style.left = `${String(at)}%`;
        bad.style.width = `${String(100 - at)}%`;
      }
      track.append(bad);
    }
    track.append(input);

    const commit = (live: boolean): void => {
      const next = Number(input.value);
      shown.textContent = format(next);
      mark(next);
      if (live) return;
      control.apply(next);
      params.put(control.key, next, initial);
    };
    // The label and the marking update live on every movement even when the *apply* waits for
    // the release, so a `commit: 'change'` slider still reads as a slider rather than as a
    // control that has stopped responding.
    input.addEventListener('input', () => commit(control.commit === 'change'));
    if (control.commit === 'change') input.addEventListener('change', () => commit(false));

    setters.set(control.key, (v) => {
      input.value = String(v);
      shown.textContent = format(Number(v));
      mark(Number(v));
    });

    row.append(label, paramLine(control), track);
    if (control.wrong !== undefined) row.append(saysLine(control.wrong));
    mark(value);
    if (value !== initial) control.apply(value);
    return row;
  }

  if (control.kind === 'toggle') {
    const initial = control.value;
    const value = params.bool(control.key, initial);
    const input = element('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = value;
    label.htmlFor = id;
    label.append(input);
    input.addEventListener('change', () => {
      mark(input.checked);
      control.apply(input.checked);
      params.put(control.key, input.checked, initial);
    });
    setters.set(control.key, (v) => {
      input.checked = v === true;
      mark(input.checked);
    });
    row.append(label, paramLine(control));
    if (control.wrong !== undefined) row.append(saysLine(control.wrong));
    mark(value);
    if (value !== initial) control.apply(value);
    return row;
  }

  if (control.kind === 'choice') {
    const initial = control.value;
    const value = params.str(control.key, initial);
    const select = element('select');
    select.id = id;
    for (const option of control.options) {
      const node = element('option', undefined, option.label);
      node.value = option.value;
      select.append(node);
    }
    select.value = value;
    label.htmlFor = id;
    label.append(shown);
    select.addEventListener('change', () => {
      mark(select.value);
      control.apply(select.value);
      params.put(control.key, select.value, initial);
    });
    setters.set(control.key, (v) => {
      select.value = String(v);
      mark(select.value);
    });
    row.append(label, paramLine(control), select);
    if (control.wrong !== undefined) row.append(saysLine(control.wrong));
    mark(value);
    if (value !== initial) control.apply(value);
    return row;
  }

  const initial = control.value;
  const value = params.str(control.key, initial);
  const input = element('input');
  input.type = 'text';
  input.id = id;
  input.value = value;
  input.spellcheck = false;
  input.autocomplete = 'off';
  if (control.placeholder !== undefined) input.placeholder = control.placeholder;
  label.htmlFor = id;
  input.addEventListener('change', () => {
    control.apply(input.value);
    params.put(control.key, input.value, initial);
  });
  setters.set(control.key, (v) => {
    input.value = String(v);
  });
  row.append(label, paramLine(control), input);
  return row;
}

/** The kit parameter this control drives, rendered. The line that makes a panel a map. */
function paramLine(control: Control): HTMLElement {
  const wrap = element('span', `${PANEL_CLASS}-param`, control.param);
  if (control.note === undefined) return wrap;
  const holder = element('div');
  holder.append(wrap, element('span', `${PANEL_CLASS}-note`, control.note));
  return holder;
}

function saysLine(wrong: Wrong): HTMLElement {
  return element('div', `${PANEL_CLASS}-says`, wrong.says);
}
