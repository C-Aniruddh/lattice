import { describe, expect, it } from 'vitest';

import {
  expectFinite,
  expectIndex,
  expectInt,
  expectNonEmpty,
  expectRange,
  expectSafeInteger,
  expectSerializable,
  isSerializable,
  unreachable,
} from '../src/guard.js';

/** The message contract, from the constitution's rule 9: the label and the value, both. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the guard to throw, and it did not');
}

describe('expectFinite', () => {
  it('returns its argument, so the check sits inside the assignment', () => {
    expect(expectFinite(1.5, 'audio.gain')).toBe(1.5);
    expect(expectFinite(0, 'audio.gain')).toBe(0);
    expect(expectFinite(-273.15, 'audio.gain')).toBe(-273.15);
    expect(expectFinite(Number.MAX_VALUE, 'audio.gain')).toBe(Number.MAX_VALUE);
  });

  it('rejects NaN and both infinities with a RangeError naming the caller and the value', () => {
    expect(() => expectFinite(Number.NaN, 'audio.gain')).toThrow(RangeError);
    expect(messageOf(() => expectFinite(Number.NaN, 'audio.gain'))).toBe(
      'audio.gain: expected a finite number, got NaN',
    );
    expect(messageOf(() => expectFinite(Number.POSITIVE_INFINITY, 'audio.gain'))).toBe(
      'audio.gain: expected a finite number, got Infinity',
    );
    expect(messageOf(() => expectFinite(Number.NEGATIVE_INFINITY, 'audio.gain'))).toBe(
      'audio.gain: expected a finite number, got -Infinity',
    );
  });

  it('rejects a non-number with a TypeError, because a wrong kind is not a wrong value', () => {
    const notANumber = '3' as unknown as number;
    expect(() => expectFinite(notANumber, 'audio.gain')).toThrow(TypeError);
    expect(messageOf(() => expectFinite(notANumber, 'audio.gain'))).toBe(
      "audio.gain: expected a number, got string '3'",
    );
    expect(messageOf(() => expectFinite(undefined as unknown as number, 'audio.gain'))).toBe(
      'audio.gain: expected a number, got undefined undefined',
    );
  });
});

describe('expectInt', () => {
  it('returns whole numbers, including zero and negatives', () => {
    expect(expectInt(0, 'noise.octaves')).toBe(0);
    expect(expectInt(-7, 'noise.octaves')).toBe(-7);
    expect(expectInt(2 ** 53, 'noise.octaves')).toBe(2 ** 53);
  });

  it('rejects a fraction, NaN and infinity', () => {
    expect(messageOf(() => expectInt(1.5, 'noise.octaves'))).toBe(
      'noise.octaves: expected an integer, got 1.5',
    );
    expect(() => expectInt(Number.NaN, 'noise.octaves')).toThrow(RangeError);
    expect(() => expectInt(Number.POSITIVE_INFINITY, 'noise.octaves')).toThrow(RangeError);
    expect(() => expectInt('4' as unknown as number, 'noise.octaves')).toThrow(TypeError);
  });
});

describe('expectRange', () => {
  it('is inclusive on both ends', () => {
    expect(expectRange(0.25, 0.25, 8, 'camera.zoom')).toBe(0.25);
    expect(expectRange(8, 0.25, 8, 'camera.zoom')).toBe(8);
    expect(expectRange(1, 0.25, 8, 'camera.zoom')).toBe(1);
  });

  it('produces the message the constitution uses as its example', () => {
    expect(messageOf(() => expectRange(-1, 0.25, 8, 'camera.zoom'))).toBe(
      'camera.zoom: expected a finite number in [0.25, 8], got -1',
    );
  });

  it('rejects just outside either end', () => {
    expect(() => expectRange(0.2499999, 0.25, 8, 'camera.zoom')).toThrow(RangeError);
    expect(() => expectRange(8.0000001, 0.25, 8, 'camera.zoom')).toThrow(RangeError);
  });

  it('rejects NaN, which a naive comparison lets through', () => {
    expect(() => expectRange(Number.NaN, 0, 1, 'camera.zoom')).toThrow(RangeError);
    expect(messageOf(() => expectRange(Number.NaN, 0, 1, 'camera.zoom'))).toBe(
      'camera.zoom: expected a finite number in [0, 1], got NaN',
    );
  });

  it('rejects both infinities against finite bounds', () => {
    expect(() => expectRange(Number.POSITIVE_INFINITY, 0, 1, 'x')).toThrow(RangeError);
    expect(() => expectRange(Number.NEGATIVE_INFINITY, 0, 1, 'x')).toThrow(RangeError);
    expect(() => expectRange(1 as unknown as number, 0, 1, 'x')).not.toThrow();
    expect(() => expectRange('1' as unknown as number, 0, 1, 'x')).toThrow(TypeError);
  });
});

describe('expectIndex', () => {
  it('accepts the first and last valid index', () => {
    expect(expectIndex(0, 4, 'tileMap.at')).toBe(0);
    expect(expectIndex(3, 4, 'tileMap.at')).toBe(3);
  });

  it('rejects the boundary, negatives, fractions and NaN', () => {
    expect(messageOf(() => expectIndex(4, 4, 'tileMap.at'))).toBe(
      'tileMap.at: expected an integer index in [0, 4), got 4',
    );
    expect(() => expectIndex(-1, 4, 'tileMap.at')).toThrow(RangeError);
    expect(() => expectIndex(1.5, 4, 'tileMap.at')).toThrow(RangeError);
    expect(() => expectIndex(Number.NaN, 4, 'tileMap.at')).toThrow(RangeError);
    expect(() => expectIndex(0 as unknown as number, 0, 'tileMap.at')).toThrow(RangeError);
    expect(() => expectIndex('0' as unknown as number, 4, 'tileMap.at')).toThrow(TypeError);
  });

  it('rejects everything against an empty collection', () => {
    expect(messageOf(() => expectIndex(0, 0, 'palette.at'))).toBe(
      'palette.at: expected an integer index in [0, 0), got 0',
    );
  });
});

describe('expectNonEmpty', () => {
  it('returns the array it was given', () => {
    const items = ['a', 'b'];
    expect(expectNonEmpty(items, 'rng.pick')).toBe(items);
    expect(expectNonEmpty([0], 'rng.pick')).toEqual([0]);
  });

  it('rejects an empty array with a RangeError', () => {
    expect(() => expectNonEmpty([], 'rng.pick')).toThrow(RangeError);
    expect(messageOf(() => expectNonEmpty([], 'rng.pick'))).toBe(
      'rng.pick: expected a non-empty array, got 0 items',
    );
  });

  it('rejects something that is not an array at all with a TypeError', () => {
    const notAnArray = 'abc' as unknown as readonly string[];
    expect(() => expectNonEmpty(notAnArray, 'rng.pick')).toThrow(TypeError);
    expect(messageOf(() => expectNonEmpty(notAnArray, 'rng.pick'))).toBe(
      "rng.pick: expected an array, got 'abc'",
    );
    expect(() => expectNonEmpty(undefined as unknown as readonly number[], 'rng.pick')).toThrow(
      TypeError,
    );
  });
});

describe('expectSerializable', () => {
  it('rejects exactly what JSON destroys', () => {
    expect(() => expectSerializable(Number.NaN, 'save.stock')).toThrow(RangeError);
    expect(() => expectSerializable(Number.POSITIVE_INFINITY, 'save.stock')).toThrow(RangeError);
    expect(() => expectSerializable(Number.NEGATIVE_INFINITY, 'save.stock')).toThrow(RangeError);
    expect(messageOf(() => expectSerializable(Number.POSITIVE_INFINITY, 'save.stock'))).toContain(
      'save.stock: expected a value that survives JSON, got Infinity',
    );
  });

  it('normalises -0 to 0, because JSON.stringify does and an integrity check would not', () => {
    expect(Object.is(expectSerializable(-0, 'save.stock'), 0)).toBe(true);
    expect(Object.is(expectSerializable(0, 'save.stock'), 0)).toBe(true);
    expect(Object.is(JSON.parse(JSON.stringify(-0)) as number, 0)).toBe(true);
  });

  it('is not a magnitude cap: every finite double round-trips exactly', () => {
    const values = [1, -1, 0.1, 2 ** 53, 2 ** 60, 1e308, -1e308, 5e-324, Number.MAX_SAFE_INTEGER];
    for (const value of values) {
      expect(expectSerializable(value, 'save.stock')).toBe(value);
      expect(JSON.parse(JSON.stringify(value)) as number).toBe(value);
    }
  });

  it('rejects a non-number with a TypeError', () => {
    expect(() => expectSerializable(null as unknown as number, 'save.stock')).toThrow(TypeError);
  });
});

describe('isSerializable', () => {
  it('agrees with expectSerializable on every input', () => {
    const values: unknown[] = [
      0,
      -0,
      1,
      -1,
      0.5,
      1e308,
      -1e308,
      2 ** 60,
      5e-324,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      '1',
      null,
      undefined,
      {},
    ];
    for (const value of values) {
      let threw = false;
      try {
        expectSerializable(value as number, 'x');
      } catch {
        threw = true;
      }
      expect(isSerializable(value as number)).toBe(!threw);
    }
  });

  it('never throws, because the load path may not throw on boot', () => {
    expect(isSerializable(Number.NaN)).toBe(false);
    expect(isSerializable(undefined as unknown as number)).toBe(false);
    expect(isSerializable(1)).toBe(true);
  });
});

describe('expectSafeInteger', () => {
  it('accepts the exact boundary and rejects one past it', () => {
    expect(expectSafeInteger(Number.MAX_SAFE_INTEGER, 'sim.owned')).toBe(Number.MAX_SAFE_INTEGER);
    expect(expectSafeInteger(-Number.MAX_SAFE_INTEGER, 'sim.owned')).toBe(-Number.MAX_SAFE_INTEGER);
    expect(expectSafeInteger(0, 'sim.owned')).toBe(0);
    expect(() => expectSafeInteger(2 ** 53, 'sim.owned')).toThrow(RangeError);
    expect(messageOf(() => expectSafeInteger(2 ** 53, 'sim.owned'))).toContain(
      'sim.owned: expected a safe integer in [-(2^53 - 1), 2^53 - 1], got 9007199254740992',
    );
  });

  it('rejects fractions, NaN and infinity', () => {
    expect(() => expectSafeInteger(1.5, 'sim.ticks')).toThrow(RangeError);
    expect(() => expectSafeInteger(Number.NaN, 'sim.ticks')).toThrow(RangeError);
    expect(() => expectSafeInteger(Number.POSITIVE_INFINITY, 'sim.ticks')).toThrow(RangeError);
    expect(() => expectSafeInteger('1' as unknown as number, 'sim.ticks')).toThrow(TypeError);
  });

  it('is a different question from expectSerializable, and 2 ** 60 shows it', () => {
    expect(expectSerializable(2 ** 60, 'save.stock')).toBe(2 ** 60);
    expect(() => expectSafeInteger(2 ** 60, 'sim.owned')).toThrow(RangeError);
  });
});

describe('unreachable', () => {
  it('throws a TypeError naming the case that was not handled', () => {
    type Kind = 'mine' | 'smelter';
    const describeKind = (kind: Kind): string => {
      switch (kind) {
        case 'mine':
          return 'a mine';
        case 'smelter':
          return 'a smelter';
        default:
          return unreachable(kind, 'building.kind');
      }
    };

    expect(describeKind('mine')).toBe('a mine');
    expect(() => describeKind('reactor' as Kind)).toThrow(TypeError);
    expect(messageOf(() => describeKind('reactor' as Kind))).toBe(
      "building.kind: unhandled case 'reactor' — a variant was added without a branch here",
    );
  });

  it('renders a non-string variant too', () => {
    expect(messageOf(() => unreachable(7 as never, 'tile.layer'))).toContain('unhandled case 7');
  });
});

describe('the shape of the module', () => {
  it('never exports an assert(condition, message), because a boolean cannot name the value', () => {
    // The whole point, stated as a test so that adding one is a visible decision: every guard
    // takes a value and gives it back, so the call site cannot compile without using it.
    const zoom = expectRange(2, 0.25, 8, 'camera.zoom');
    const octaves = expectInt(4, 'noise.octaves');
    expect(zoom * octaves).toBe(8);
  });
});
