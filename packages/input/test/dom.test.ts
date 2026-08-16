/**
 * The adapter, against a hand-rolled DOM.
 *
 * Invariants 11, 12, 14 and 15 live here because they are about the browser and nothing else:
 * element-relative coordinates, the key that must never become an action, the overlay that eats
 * every tap, and the second binding on one canvas.
 *
 * Every test in this file corresponds to a trap in the module header. That is deliberate: the
 * value of an adapter is entirely in the quirks it absorbs, so a test file that only checked
 * that a pointerdown produces a `down` would be testing the easy half.
 */

import { describe, expect, it, vi } from 'vitest';
import { createCamera } from '@lattice/iso';
import type { GridPoint } from '@lattice/iso';
import { createInput } from '../src/dom.js';
import { record } from '../src/record.js';
import { DEFAULT_PROFILE } from '../src/profile.js';
import type { Diagnostic } from '../src/sample.js';
import type { FakeElement, FakeWorld } from './fakedom.js';
import { FakeElement as Element, prevented, world } from './fakedom.js';
import { STEP_60, types, watch } from './harness.js';

/** Build a bound system over a fake world, with the diagnostics captured. */
function bind(options?: { keepContextMenu?: boolean }) {
  const w = world();
  const diagnostics: Diagnostic[] = [];
  const input = createInput({
    element: w.element as unknown as HTMLElement,
    camera: createCamera(800, 600),
    step: STEP_60,
    actions: { collect: ['tap', 'key:Space'] },
    onDiagnostic: (d): void => {
      diagnostics.push(d);
    },
    ...options,
  });
  return { w, input, diagnostics, seen: watch(input) };
}

/** Everything a pointer event needs, with the element's rect already accounted for. */
function pointer(clientX: number, clientY: number, extra?: Record<string, unknown>) {
  return { pointerId: 1, pointerType: 'mouse', clientX, clientY, ...extra };
}

describe('binding', () => {
  it('refuses anything that is not an element', () => {
    const camera = createCamera(800, 600);
    expect(() => createInput({ element: null as unknown as HTMLElement, camera, step: STEP_60 })).toThrow(
      /expected the element the world is drawn on/,
    );
  });

  it('I15 — refuses a second binding on one element, and allows it after dispose', () => {
    const { w, input } = bind();
    const second = {
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
    };
    // Without this the symptom is a camera that pans twice as fast and a game that is
    // impossible to debug.
    expect(() => createInput(second)).toThrow(/already has a live input binding/);
    input.dispose();
    const again = createInput(second);
    expect(again.element).toBe(w.element);
    again.dispose();
  });

  it('sets the three styles and puts them back exactly', () => {
    const w = world();
    // A game that had already styled the surface must get its declaration back, not a blank.
    w.element.style.setProperty('user-select', 'text');
    const input = createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
    });
    expect(w.element.style.getPropertyValue('touch-action')).toBe('none');
    expect(w.element.style.getPropertyValue('overscroll-behavior')).toBe('contain');
    expect(w.element.style.getPropertyValue('user-select')).toBe('none');
    input.dispose();
    // The two that were unset before are removed rather than left as an empty declaration.
    expect(w.element.style.snapshot()).toEqual({ 'user-select': 'text' });
  });

  it('exposes the element it bound, and records through the same identity', () => {
    const { w, input } = bind();
    expect(input.element).toBe(w.element);
    // A wrapper object would have refused to record, an hour into a debugging session.
    expect(record(input).stop().stepMs).toBe(STEP_60.stepMs);
  });

  it('diagnoses a stylesheet that beats the inline touch-action, and a dead surface', () => {
    const w = world();
    w.view.computed = { 'touch-action': 'auto', 'pointer-events': 'none' };
    const diagnostics: Diagnostic[] = [];
    createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
      onDiagnostic: (d): void => {
        diagnostics.push(d);
      },
    });
    expect(diagnostics.map((d) => d.code)).toEqual([
      'touch-action-overridden',
      'pointer-events-none',
    ]);
    expect(diagnostics[0]?.element).toBe(w.element);
  });

  it('binds in a document with no window at all', () => {
    const w = world();
    w.doc.defaultView = null;
    const input = createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
    });
    // No computed style to check, no window to listen to, and still a working recognizer.
    w.fire('pointerdown', pointer(500, 350));
    expect(input.buffered).toBe(1);
    input.dispose();
  });

  it('binds where ResizeObserver does not exist', () => {
    const w = world();
    w.view.hasResizeObserver = false;
    const input = createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
    });
    expect(w.view.observers).toEqual([]);
    input.dispose();
  });
});

describe('I11 — coordinates are element-relative', () => {
  it('subtracts the rect, and re-reads it after a scroll or a resize', () => {
    const { w, input } = bind();
    const point = { x: 0, y: 0 };
    // The element is at (100, 50): a client point of (150, 80) is (50, 30) on the surface.
    w.fire('pointerdown', pointer(150, 80));
    expect(input.pointerScreen(point)).toBe(true);
    expect(point).toEqual({ x: 50, y: 30 });

    const reads = w.element.rects;
    w.fire('pointermove', pointer(160, 90));
    // Cached: `getBoundingClientRect()` per pointermove forces layout a thousand times a second.
    expect(w.element.rects).toBe(reads);

    w.element.rect = { ...w.element.rect, left: 0, top: 0 };
    w.fire('scroll', {}, w.doc);
    w.fire('pointermove', pointer(160, 90));
    input.pointerScreen(point);
    expect(point).toEqual({ x: 160, y: 90 });

    w.element.rect = { ...w.element.rect, left: 20, top: 10 };
    w.fire('resize', {}, w.view);
    w.fire('pointermove', pointer(160, 90));
    input.pointerScreen(point);
    expect(point).toEqual({ x: 140, y: 80 });
  });

  it('re-reads the rect when the element resizes without the window', () => {
    const { w, input } = bind();
    const point = { x: 0, y: 0 };
    w.fire('pointermove', pointer(150, 80));
    w.element.rect = { ...w.element.rect, left: 0, top: 0 };
    const observer = w.view.observers[0];
    expect(observer?.observing).toBe(w.element);
    observer?.callback();
    w.fire('pointermove', pointer(150, 80));
    input.pointerScreen(point);
    expect(point).toEqual({ x: 150, y: 80 });
  });
});

describe('pointer capture', () => {
  it('takes capture on down and releases it on up', () => {
    const { w } = bind();
    w.fire('pointerdown', pointer(150, 80));
    // A drag under a `ui` panel keeps its moves, and a gesture that starts on the world ends on
    // the world.
    expect([...w.element.captured]).toEqual([1]);
    w.fire('pointerup', pointer(150, 80));
    expect(w.element.captured.size).toBe(0);
  });

  it('carries on when the browser refuses the capture', () => {
    const { w, input } = bind();
    w.element.refuseCapture = true;
    w.fire('pointerdown', pointer(150, 80));
    // A pointer already gone throws here, and the recognizer's exit does not depend on capture.
    expect(input.buffered).toBe(1);
    expect(() => {
      w.fire('pointerup', pointer(150, 80));
    }).not.toThrow();
  });

  it('turns a lost capture into a cancel, and ignores a second one', () => {
    const { w, input, seen } = bind();
    w.fire('pointerdown', pointer(150, 80));
    input.tick(0);
    w.fire('pointermove', pointer(250, 80));
    input.tick(1);
    w.fire('lostpointercapture', pointer(250, 80));
    w.fire('lostpointercapture', pointer(250, 80));
    input.tick(2);
    // Without this the recognizer sits in a dragging state for ever, and the first symptom is a
    // camera the player cannot stop.
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
  });

  it('turns a pointercancel into a cancel', () => {
    const { w, input, seen } = bind();
    w.fire('pointerdown', pointer(150, 80));
    input.tick(0);
    w.fire('pointermove', pointer(250, 80));
    input.tick(1);
    w.fire('pointercancel', pointer(250, 80));
    input.tick(2);
    expect(types(seen)).toEqual(['dragstart', 'dragend']);
    expect(w.element.captured.size).toBe(0);
  });

  it('releases every capture on dispose, and removes every listener', () => {
    const { w, input } = bind();
    w.fire('pointerdown', pointer(150, 80));
    expect(w.element.captured.size).toBe(1);
    input.dispose();
    expect(w.element.captured.size).toBe(0);
    expect(w.element.bound).toBe(0);
    expect(w.doc.bound).toBe(0);
    expect(w.view.bound).toBe(0);
  });
});

describe('coalesced moves', () => {
  it('keeps every position a 120 Hz pointer reported', () => {
    const { w, input } = bind();
    w.fire('pointerdown', pointer(150, 80));
    w.fire('pointermove', {
      ...pointer(200, 80),
      getCoalescedEvents: (): unknown[] => [
        { clientX: 160, clientY: 80 },
        { clientX: 180, clientY: 80 },
        { clientX: 200, clientY: 80 },
      ],
    });
    // For panning the newest is enough; for a stroke the set is the difference between a smooth
    // line and a polygon.
    expect(input.buffered).toBe(4);
  });

  it('falls back to the event itself when the list is empty', () => {
    const { w, input } = bind();
    w.fire('pointerdown', pointer(150, 80));
    w.fire('pointermove', {
      ...pointer(200, 80),
      getCoalescedEvents: (): unknown[] => [],
    });
    expect(input.buffered).toBe(2);
  });
});

describe('the wheel', () => {
  it('normalizes all three delta modes and consumes the event', () => {
    const { w, input, seen } = bind();
    for (const [deltaMode, deltaY] of [
      [0, -100],
      [1, -3],
      [2, -1],
    ] as const) {
      w.fire('wheel', { clientX: 500, clientY: 350, deltaY, deltaMode, ctrlKey: false });
    }
    input.tick(0);
    const scales = seen.filter((s) => s.type === 'zoom').map((s) => s.scale);
    // Firefox reports 3 lines where Chrome reports 100 pixels; without the conversion the same
    // flick zooms about 30× less there.
    expect(scales[0]).toBe(Math.exp(100 * DEFAULT_PROFILE.wheelZoomRate));
    expect(scales[1]).toBe(Math.exp(3 * DEFAULT_PROFILE.wheelLinePx * DEFAULT_PROFILE.wheelZoomRate));
    expect(scales[2]).toBe(Math.exp(DEFAULT_PROFILE.wheelPagePx * DEFAULT_PROFILE.wheelZoomRate));
  });

  it('reads ctrlKey as a trackpad pinch, and preventDefaults so the page does not zoom', () => {
    const { w, input, seen } = bind();
    let event: object | undefined;
    w.element.addEventListener('wheel', (e): void => {
      event = e as object;
    });
    w.fire('wheel', { clientX: 500, clientY: 350, deltaY: -10, deltaMode: 0, ctrlKey: true });
    input.tick(0);
    expect(seen[0]?.scale).toBe(Math.exp(10 * DEFAULT_PROFILE.wheelPinchRate));
    expect(event !== undefined && prevented.has(event)).toBe(true);
  });
});

describe('I12 — a key aimed at a field never becomes an action', () => {
  it('ignores fields, contenteditable, modifiers and auto-repeat', () => {
    const { w, input } = bind();
    const field = new Element(w.doc, 'INPUT');
    const editable = new Element(w.doc, 'DIV');
    editable.isContentEditable = true;

    // Pasting a code containing the letter *b* must not open the shop mid-paste.
    w.fire('keydown', { code: 'Space', repeat: false }, field);
    w.fire('keydown', { code: 'Space', repeat: false }, editable);
    // And command-R still reloads.
    w.fire('keydown', { code: 'Space', repeat: false, metaKey: true });
    w.fire('keydown', { code: 'Space', repeat: false, ctrlKey: true });
    w.fire('keydown', { code: 'Space', repeat: false, altKey: true });
    w.fire('keydown', { code: 'Space', repeat: true });
    expect(input.buffered).toBe(0);

    w.fire('keydown', { code: 'Space', repeat: false });
    expect(input.buffered).toBe(1);
    input.tick(0);
    expect(input.keyHeld('Space')).toBe(true);
  });

  it('releases a key even while a modifier is down, so nothing sticks', () => {
    const { w, input } = bind();
    w.fire('keydown', { code: 'KeyW', repeat: false });
    input.tick(0);
    // A key pressed plainly and released while command is held would otherwise stay down for
    // ever.
    w.fire('keyup', { code: 'KeyW', metaKey: true });
    input.tick(1);
    expect(input.keyHeld('KeyW')).toBe(false);
  });

  it('ignores a keyup aimed at a field', () => {
    const { w, input } = bind();
    const field = new Element(w.doc, 'TEXTAREA');
    w.fire('keydown', { code: 'KeyW', repeat: false });
    input.tick(0);
    w.fire('keyup', { code: 'KeyW' }, field);
    expect(input.buffered).toBe(0);
  });
});

describe('losing the window', () => {
  it('releases everything on blur and on being hidden, and not on being shown', () => {
    const { w, input } = bind();
    w.fire('keydown', { code: 'KeyW', repeat: false });
    input.tick(0);
    w.fire('blur', {}, w.view);
    input.tick(1);
    expect(input.keyHeld('KeyW')).toBe(false);

    w.fire('keydown', { code: 'KeyW', repeat: false });
    input.tick(2);
    w.doc.visibilityState = 'visible';
    w.fire('visibilitychange', {}, w.doc);
    input.tick(3);
    expect(input.keyHeld('KeyW')).toBe(true);
    w.doc.visibilityState = 'hidden';
    w.fire('visibilitychange', {}, w.doc);
    input.tick(4);
    expect(input.keyHeld('KeyW')).toBe(false);
  });
});

describe('the context menu', () => {
  it('is suppressed by default and kept when the game asks', () => {
    const { w } = bind();
    let event: object | undefined;
    w.element.addEventListener('contextmenu', (e): void => {
      event = e as object;
    });
    w.fire('contextmenu', {});
    // A long press on Android raises it mid-gesture, on top of the building just lifted.
    expect(event !== undefined && prevented.has(event)).toBe(true);

    const kept = bind({ keepContextMenu: true });
    let keptEvent: object | undefined;
    kept.w.element.addEventListener('contextmenu', (e): void => {
      keptEvent = e as object;
    });
    kept.w.fire('contextmenu', {});
    expect(keptEvent !== undefined && prevented.has(keptEvent)).toBe(false);
  });
});

describe('I14 — the overlay diagnostic', () => {
  it('names the element covering the world, once', () => {
    const { w, diagnostics } = bind();
    const spacer = new Element(w.doc, 'DIV');
    // `#ui > * { pointer-events: auto }` out-specifies a bare `.spacer { pointer-events: none }`.
    w.fire('pointerdown', pointer(500, 350), spacer);
    w.fire('pointerdown', pointer(510, 360), spacer);
    expect(diagnostics.map((d) => d.code)).toEqual(['covered-by-overlay']);
    expect(diagnostics[0]?.element).toBe(spacer);
  });

  it('says nothing for a press outside the world, or on a child of it', () => {
    const { w, diagnostics } = bind();
    const child = new Element(w.doc, 'DIV');
    w.element.append(child);
    w.fire('pointerdown', pointer(500, 350), child);
    w.fire('pointerdown', pointer(5, 5), new Element(w.doc, 'DIV'));
    w.fire('pointerdown', pointer(5000, 5000), new Element(w.doc, 'DIV'));
    w.fire('pointerdown', pointer(500, 5000), new Element(w.doc, 'DIV'));
    w.fire('pointerdown', pointer(500, 350), null);
    expect(diagnostics.filter((d) => d.code === 'covered-by-overlay')).toHaveLength(1);
  });

  it('goes to console.warn when the game gave no sink', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = world();
    createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
    });
    w.fire('pointerdown', pointer(500, 350), new Element(w.doc, 'DIV'));
    expect(warn.mock.calls[0]?.[0]).toContain('covered-by-overlay');
  });

  it('reads the cached rect, so a press anywhere on the page forces no layout', () => {
    const { w } = bind();
    // Every tap on a HUD reaches this listener. The uncached version read the rect on each one,
    // for the life of the game.
    w.fire('pointerdown', pointer(500, 350), new Element(w.doc, 'DIV'));
    const reads = w.element.rects;
    for (let i = 0; i < 20; i++) {
      w.fire('pointerdown', pointer(500, 350), new Element(w.doc, 'DIV'));
    }
    expect(w.element.rects).toBe(reads);
  });
});

/**
 * K12: the diagnostic used to fire on the first tap on *any* HUD over the canvas, including
 * every `@lattice/ui` panel — which `GALLERY.md` makes mandatory, so every planned exhibit
 * would have hit it. The discriminator is whether anything declared `pointer-events` inline.
 */
describe('K12 — chrome that declared itself is not a cover', () => {
  /** A node that `@lattice/ui`'s `mount(node, { interactive: true })` has granted. It writes the
   *  grant inline and ships no stylesheet, which is what makes this detectable at all. */
  function granted(w: FakeWorld, value = 'auto'): FakeElement {
    const node = new Element(w.doc, 'DIV');
    node.style.setProperty('pointer-events', value);
    return node;
  }

  it('says nothing for a node that was granted pointer events inline', () => {
    const { w, diagnostics } = bind();
    w.fire('pointerdown', pointer(500, 350), granted(w));
    expect(diagnostics).toEqual([]);
  });

  it('says nothing for a child of one, which takes the press by inheritance', () => {
    const { w, diagnostics } = bind();
    // A `ui` panel grants the panel; the button inside it is `auto` because it inherits, and it
    // is the button that becomes `event.target`.
    const label = granted(w).append(new Element(w.doc, 'SPAN'));
    w.fire('pointerdown', pointer(500, 350), label);
    expect(diagnostics).toEqual([]);
  });

  it('treats any inline value that is not none as a grant, including the SVG spellings', () => {
    const { w, diagnostics } = bind();
    w.fire('pointerdown', pointer(500, 350), granted(w, 'visiblePainted'));
    expect(diagnostics).toEqual([]);
  });

  it('still reports the trap: an inline none that a stylesheet beat underneath', () => {
    const { w, diagnostics } = bind();
    // The exact failure the diagnostic was written for. The layer says `none` inline; the spacer
    // inside it says nothing inline and computes to `auto` because `#ui > *` out-specifies
    // `.spacer`. The walk stops at the first declaration it meets, and that declaration lost.
    const layer = granted(w, 'none');
    const spacer = layer.append(new Element(w.doc, 'DIV'));
    w.fire('pointerdown', pointer(500, 350), spacer);
    expect(diagnostics.map((d) => d.code)).toEqual(['covered-by-overlay']);
    expect(diagnostics[0]?.element).toBe(spacer);
    expect(diagnostics[0]?.message).toContain('declares pointer-events inline');
  });

  it('still reports a bare element with no declaration anywhere above it', () => {
    const { w, diagnostics } = bind();
    const outer = new Element(w.doc, 'DIV');
    const inner = outer.append(new Element(w.doc, 'DIV'));
    w.fire('pointerdown', pointer(500, 350), inner);
    expect(diagnostics.map((d) => d.code)).toEqual(['covered-by-overlay']);
  });

  it('says nothing inside a root the game declared, which is the escape for a CSS-only HUD', () => {
    const w = world();
    const hud = new Element(w.doc, 'DIV');
    const slider = hud.append(new Element(w.doc, 'INPUT'));
    const diagnostics: Diagnostic[] = [];
    createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
      overlays: [hud as unknown as HTMLElement],
      onDiagnostic: (d): void => {
        diagnostics.push(d);
      },
    });
    // Neither of these declares anything inline — the gallery's panel is styled entirely from a
    // stylesheet — so without `overlays` both would be reported.
    w.fire('pointerdown', pointer(500, 350), hud);
    w.fire('pointerdown', pointer(500, 350), slider);
    expect(diagnostics).toEqual([]);
  });

  it('reads overlays when the cover is found, so a HUD built after the input still counts', () => {
    const w = world();
    const late: HTMLElement[] = [];
    const diagnostics: Diagnostic[] = [];
    createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
      overlays: late,
      onDiagnostic: (d): void => {
        diagnostics.push(d);
      },
    });
    const hud = new Element(w.doc, 'DIV');
    late.push(hud as unknown as HTMLElement);
    w.fire('pointerdown', pointer(500, 350), hud);
    expect(diagnostics).toEqual([]);
  });

  it('treats an element with no inline style at all as having declared nothing', () => {
    const { w, diagnostics } = bind();
    // `Element` does not declare `style`, so the walk has to survive a node that has none rather
    // than assuming every ancestor is an `HTMLElement`.
    const styleless = { tagName: 'DIV', parentElement: null };
    w.fire('pointerdown', pointer(500, 350), styleless);
    expect(diagnostics.map((d) => d.code)).toEqual(['covered-by-overlay']);
  });

  it('reports a node outside every declared root, so overlays is not a blanket mute', () => {
    const w = world();
    const hud = new Element(w.doc, 'DIV');
    const diagnostics: Diagnostic[] = [];
    createInput({
      element: w.element as unknown as HTMLElement,
      camera: createCamera(800, 600),
      step: STEP_60,
      overlays: [hud as unknown as HTMLElement],
      onDiagnostic: (d): void => {
        diagnostics.push(d);
      },
    });
    w.fire('pointerdown', pointer(500, 350), new Element(w.doc, 'DIV'));
    expect(diagnostics.map((d) => d.code)).toEqual(['covered-by-overlay']);
  });
});

describe('the small print', () => {
  it('reads pointerType for a pen and for anything it does not recognize', () => {
    const { w, input, seen } = bind();
    // 6 px of travel: past the pen's slop of 6 and under the touch slop of 9.
    w.fire('pointerdown', { ...pointer(200, 200), pointerType: 'pen' });
    w.fire('pointermove', { ...pointer(207, 200), pointerType: 'pen' });
    input.tick(0);
    expect(types(seen)).toEqual(['dragstart']);
    expect(seen[0]?.type === 'dragstart' && seen[0]?.dx).toBe(7);

    const other = bind();
    // Some older browsers report an empty pointerType. A wrong guess costs 5 px of slop;
    // refusing the event costs the whole gesture.
    other.w.fire('pointerdown', { ...pointer(200, 200), pointerType: '' });
    other.w.fire('pointermove', { ...pointer(206, 200), pointerType: '' });
    other.input.tick(0);
    expect(types(other.seen)).toEqual(['dragstart']);
  });

  it('ignores a key event with no target at all', () => {
    const { w, input } = bind();
    w.fire('keydown', { code: 'Space', repeat: false }, null);
    input.tick(0);
    expect(input.keyHeld('Space')).toBe(true);
  });

  it('is idempotent to dispose', () => {
    const { w, input } = bind();
    input.dispose();
    expect(() => {
      input.dispose();
    }).not.toThrow();
    expect(w.element.bound).toBe(0);
  });
});

describe('a whole gesture, through the DOM', () => {
  it('taps a tile', () => {
    const { w, input, seen } = bind();
    const tile: GridPoint = { gx: 0, gy: 0 };
    const collected: number[] = [];
    input.onAction('collect', (a): void => {
      collected.push(a.gx, a.gy);
    });
    w.fire('pointerdown', { ...pointer(500, 350), pointerType: 'touch' });
    input.tick(0);
    w.fire('pointerup', { ...pointer(500, 350), pointerType: 'touch' });
    input.tick(1);
    expect(types(seen)).toEqual(['tap']);
    expect(input.hoverTile(tile)).toBe(false);
    expect(collected).toEqual([seen[0]?.gx, seen[0]?.gy]);
  });

  it('pans the camera with a mouse drag, and glides on release', () => {
    const w = world();
    const camera = createCamera(800, 600);
    const input = createInput({
      element: w.element as unknown as HTMLElement,
      camera,
      step: STEP_60,
    });
    w.fire('pointerdown', pointer(500, 350));
    input.tick(0);
    for (let i = 1; i <= 4; i++) {
      w.fire('pointermove', pointer(500 + i * 40, 350));
      input.tick(i);
    }
    expect(camera.x).toBeLessThan(0);
    w.fire('pointerup', pointer(700, 350));
    input.tick(5);
    expect(input.camera.gliding).toBe(true);
    input.dispose();
  });
});

/** `FakeElement` is imported twice: once as a type, once as a value the tests construct. */
export type { FakeElement, FakeWorld };
