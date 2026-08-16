/**
 * The action map: compilation, validation, and the "one handler, three bindings" claim.
 *
 * The claim is worth stating as a test rather than a paragraph: a tap and a key press must
 * arrive at the *same* handler as the *same* kind of event, differing only in `source` and
 * `binding`, and a handler must be free to ignore both. That is the whole difference between an
 * abstraction and a naming convention.
 */

import { describe, expect, it } from 'vitest';
import { compileActions, suggestCode } from '../src/actions.js';
import type { ActionEvent } from '../src/events.js';
import type { Diagnostic } from '../src/sample.js';
import { down, harness, up } from './harness.js';

const silent = (): void => undefined;

describe('compileActions', () => {
  it('accepts an empty map, because a game with no actions still has a system', () => {
    const compiled = compileActions(undefined, 'x', silent);
    expect(compiled.names).toEqual([]);
    expect(compiled.forGesture('tap')).toEqual([]);
    expect(compiled.forKey('Space')).toEqual([]);
  });

  it('keeps declaration order, for both names and bindings', () => {
    const compiled = compileActions(
      { collect: ['tap', 'key:Space'], build: ['key:KeyB'], demolish: ['longpress'] },
      'x',
      silent,
    );
    expect(compiled.names).toEqual(['collect', 'build', 'demolish']);
    expect(compiled.bindings('collect')).toEqual(['tap', 'key:Space']);
    expect(compiled.forGesture('tap').map((e) => e.action)).toEqual(['collect']);
    expect(compiled.forGesture('longpress').map((e) => e.action)).toEqual(['demolish']);
    expect(compiled.forKey('KeyB').map((e) => e.action)).toEqual(['build']);
  });

  it('orders two actions on one key by declaration', () => {
    const compiled = compileActions({ first: ['key:KeyQ'], second: ['key:KeyQ'] }, 'x', silent);
    expect(compiled.forKey('KeyQ').map((e) => e.action)).toEqual(['first', 'second']);
  });

  it('catches the key/code confusion by name', () => {
    expect(() => compileActions({ jump: ['key:space'] }, 'createInput.actions', silent)).toThrow(
      /createInput\.actions\.jump: 'key:space' is not a KeyboardEvent\.code; did you mean 'key:Space'\?/,
    );
    expect(() => compileActions({ build: ['key:b'] }, 'x', silent)).toThrow(/did you mean 'key:KeyB'/);
    expect(() => compileActions({ five: ['key:5'] }, 'x', silent)).toThrow(/'key:Digit5'/);
  });

  it('diagnoses a code it does not recognise rather than refusing it', () => {
    const seen: Diagnostic[] = [];
    const compiled = compileActions({ yen: ['key:IntlYen'] }, 'x', (d): void => {
      seen.push(d);
    });
    // This table is not exhaustive and cannot be: refusing `IntlYen` on a Japanese keyboard
    // would be worse than the mistake the near-miss check exists to catch.
    expect(seen.map((d) => d.code)).toEqual(['unknown-key-code']);
    expect(compiled.forKey('IntlYen')).toHaveLength(1);
  });

  it('refuses a binding that is not one of the three shapes', () => {
    expect(() => compileActions({ pan: ['drag'] as never }, 'x', silent)).toThrow(
      /expected 'tap', 'longpress' or 'key:<KeyboardEvent\.code>', got "drag"/,
    );
  });

  it('refuses an action with nothing that can fire it', () => {
    expect(() => compileActions({ ghost: [] }, 'x', silent)).toThrow(/at least one binding/);
    expect(() => compileActions({ ghost: 'tap' as never }, 'x', silent)).toThrow(
      /expected an array of bindings/,
    );
  });

  it('names an action nobody declared, rather than returning nothing', () => {
    const compiled = compileActions({ collect: ['tap'] }, 'x', silent);
    // An empty array here would render a shortcut sheet with a silently missing row.
    expect(() => compiled.bindings('nope' as 'collect')).toThrow(/is not a declared action/);
    expect(() => compiled.held('nope' as 'collect', false, () => false)).toThrow(
      /is not a declared action/,
    );
  });

  it('answers held from whichever binding is holding', () => {
    const compiled = compileActions({ charge: ['tap', 'key:Space'] }, 'x', silent);
    expect(compiled.held('charge', false, () => false)).toBe(false);
    expect(compiled.held('charge', true, () => false)).toBe(true);
    expect(compiled.held('charge', false, (code) => code === 'Space')).toBe(true);
  });
});

describe('suggestCode', () => {
  it('offers only the three near misses people actually write', () => {
    expect(suggestCode('space')).toBe('Space');
    expect(suggestCode('b')).toBe('KeyB');
    expect(suggestCode('7')).toBe('Digit7');
    expect(suggestCode('Lang1')).toBeUndefined();
    expect(suggestCode('!')).toBeUndefined();
  });
});

describe('one handler, two bindings', () => {
  it('delivers a tap and a key press to the same handler as the same event', () => {
    const h = harness({
      stepMs: 100,
      actions: { collect: ['tap', 'key:Space'] },
      focus: (out): boolean => {
        out.x = 200;
        out.y = 150;
        return true;
      },
    });
    const seen: ActionEvent<'collect'>[] = [];
    h.input.onAction('collect', (a): void => {
      seen.push({ ...a, claim: a.claim });
    });

    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    h.step({ kind: 'key', code: 'Space', down: true });

    expect(seen.map((a) => [a.action, a.source, a.binding])).toEqual([
      ['collect', 'pointer', 'tap'],
      ['collect', 'key', 'key:Space'],
    ]);
    // The pointer one carries the finger; the key one carries the game's selection. Both carry
    // a tile, which is the point — the keyboard path is the one nobody tests.
    expect([seen[0]?.sx, seen[0]?.sy]).toEqual([400, 300]);
    expect([seen[1]?.sx, seen[1]?.sy]).toEqual([200, 150]);
    expect(seen[1]?.gx).toBeTypeOf('number');
  });

  it('points a keyboard action at the viewport centre when the game has no selection', () => {
    const h = harness({
      stepMs: 100,
      actions: { collect: ['key:Space'] },
      focus: (): boolean => false,
    });
    const seen: { sx: number; sy: number }[] = [];
    h.input.onAction('collect', (a): void => {
      seen.push({ sx: a.sx, sy: a.sy });
    });
    h.step({ kind: 'key', code: 'Space', down: true });
    // A game that leaves `focus` unimplemented is still playable; it just collects from the
    // middle.
    expect(seen).toEqual([{ sx: 400, sy: 300 }]);
  });

  it('does not fire an action from a gesture a handler claimed', () => {
    const h = harness({ stepMs: 100, actions: { collect: ['tap'] } });
    let fired = 0;
    h.input.on('tap', (g): void => {
      g.claim();
    });
    h.input.onAction('collect', (): void => {
      fired += 1;
    });
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(fired).toBe(0);
  });

  it('stops at the first action handler that claims', () => {
    const h = harness({ stepMs: 100, actions: { collect: ['tap'] } });
    const order: string[] = [];
    h.input.onAction('collect', (a): void => {
      order.push('first');
      a.claim();
    });
    h.input.onAction('collect', (): void => {
      order.push('second');
    });
    h.step(down(1, 400, 300, 'touch'), up(1, 400, 300));
    expect(order).toEqual(['first']);
  });
});
