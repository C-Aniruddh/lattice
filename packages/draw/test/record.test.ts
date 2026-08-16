/**
 * The headless backend — the thing that makes a golden test possible with no canvas in Node.
 *
 * What it records is the shape of the draw, not the pixels: a command log diffs into a sentence
 * and a pixel diff into a number. Two properties everything else in this suite rests on are
 * asserted here — that coordinates are CSS pixels at every device ratio, and that a target's
 * digest is folded into its parent's, so nothing hides behind an opaque bitmap.
 */

import { describe, expect, it } from 'vitest';
import { rgba } from '../src/color.js';
import { ESTIMATED_ADVANCE_RATIO, createRecordingSurface } from '../src/record.js';
import { DEFAULT_TEXT } from '../src/text.js';
import type { RecordingTarget } from '../src/record.js';

const XY = (values: readonly number[]): Float64Array => Float64Array.from(values);

describe('createRecordingSurface', () => {
  it('reports itself and its dimensions in CSS pixels', () => {
    const s = createRecordingSurface(320, 200, 2);
    expect(s.kind).toBe('recording');
    expect(s.width).toBe(320);
    expect(s.height).toBe(200);
    expect(s.pixelRatio).toBe(2);
  });

  it('refuses a surface nobody could look at, naming the parameter', () => {
    expect(() => createRecordingSurface(0, 10)).toThrow(/width/);
    expect(() => createRecordingSurface(10, Number.NaN)).toThrow(/height/);
    expect(() => createRecordingSurface(10, 10, -1)).toThrow(/pixelRatio/);
  });

  it('resizes, and refuses a bad resize the same way', () => {
    const s = createRecordingSurface(10, 10);
    s.resize(40, 50, 3);
    expect(s.width).toBe(40);
    expect(s.height).toBe(50);
    expect(s.pixelRatio).toBe(3);
    expect(() => s.resize(0, 1, 1)).toThrow(/width/);
    expect(() => s.resize(1, 0, 1)).toThrow(/height/);
    expect(() => s.resize(1, 1, 0)).toThrow(/pixelRatio/);
  });
});

describe('what each call records', () => {
  it('clear', () => {
    const s = createRecordingSurface(10, 10);
    s.begin(rgba(1, 2, 3));
    expect(s.ops[0]).toEqual({ op: 'clear', xy: [], colors: [rgba(1, 2, 3)], value: 0, text: '' });
  });

  it('poly: the points, the fill, and the count as the scalar', () => {
    const s = createRecordingSurface(10, 10);
    s.poly(XY([0, 1, 2, 3, 4, 5, 99, 99]), 3, rgba(9, 9, 9));
    expect(s.ops[0]).toEqual({
      op: 'poly',
      xy: [0, 1, 2, 3, 4, 5],
      colors: [rgba(9, 9, 9)],
      value: 3,
      text: '',
    });
  });

  it('polyRamp: the points, then the ramp segment', () => {
    const s = createRecordingSurface(10, 10);
    s.polyRamp(XY([0, 0, 1, 1]), 2, 0, 0, 10, 0, rgba(1, 0, 0), rgba(0, 0, 1));
    expect(s.ops[0]?.xy).toEqual([0, 0, 1, 1, 0, 0, 10, 0]);
    expect(s.ops[0]?.colors).toEqual([rgba(1, 0, 0), rgba(0, 0, 1)]);
  });

  it('stroke: the width as the scalar, and the shape and dash as text', () => {
    const s = createRecordingSurface(10, 10);
    s.stroke(XY([0, 0, 1, 1]), 2, false, rgba(1, 1, 1), 2);
    s.stroke(XY([0, 0, 1, 1]), 2, true, rgba(1, 1, 1), 1, 6, -3);
    s.stroke(XY([0, 0, 1, 1]), 2, true, rgba(1, 1, 1), 1, 0);
    expect(s.ops[0]?.text).toBe('open');
    expect(s.ops[0]?.value).toBe(2);
    expect(s.ops[1]?.text).toBe('closed dash 6/-3');
    expect(s.ops[2]?.text).toBe('closed');
  });

  it('ellipse and softEllipse', () => {
    const s = createRecordingSurface(10, 10);
    s.ellipse(1, 2, 3, 4, rgba(1, 1, 1));
    s.softEllipse(1, 2, 3, 4, rgba(1, 1, 1), 0);
    expect(s.ops[0]).toEqual({
      op: 'ellipse',
      xy: [1, 2, 3, 4],
      colors: [rgba(1, 1, 1)],
      value: 3,
      text: '',
    });
    expect(s.ops[1]?.colors).toEqual([rgba(1, 1, 1), 0]);
  });

  it('text: the anchor, the style, the optional transform, and the string', () => {
    const s = createRecordingSurface(10, 10);
    s.text('hi', 4, 5, DEFAULT_TEXT, rgba(1, 1, 1));
    s.text('hi', 4, 5, DEFAULT_TEXT, rgba(1, 1, 1), XY([1, 0, 0, 1, 7, 8]));
    expect(s.ops[0]?.xy).toEqual([4, 5, 12, 600, 0, 0]);
    expect(s.ops[0]?.text).toBe('hi');
    expect(s.ops[1]?.xy).toEqual([4, 5, 12, 600, 0, 0, 1, 0, 0, 1, 7, 8]);
  });

  it('alpha: the new multiplier, and the previous one handed back', () => {
    const s = createRecordingSurface(10, 10);
    expect(s.alpha(0.5)).toBe(1);
    expect(s.alpha(0.25)).toBe(0.5);
    expect(s.ops[1]?.value).toBe(0.25);
    s.begin(0);
    expect(s.alpha(0.5)).toBe(1);
  });

  it('end records nothing, so a golden does not depend on how often a frame was closed', () => {
    const s = createRecordingSurface(10, 10);
    s.end();
    s.end();
    expect(s.ops).toHaveLength(0);
  });
});

describe('rounding', () => {
  it('keeps three decimals and normalizes negative zero', () => {
    const s = createRecordingSurface(10, 10);
    s.poly(XY([1.00049, -0.0001, 2.9995, 0]), 2, 0);
    expect(s.ops[0]?.xy).toEqual([1, 0, 3, 0]);
    expect(Object.is(s.ops[0]?.xy[1], -0)).toBe(false);
  });

  it('leaves a non-finite coordinate alone rather than turning it into a plausible number', () => {
    const s = createRecordingSurface(10, 10);
    s.poly(XY([Number.NaN, Number.POSITIVE_INFINITY]), 1, 0);
    expect(s.ops[0]?.xy[0]).toBeNaN();
    expect(s.ops[0]?.xy[1]).toBe(Number.POSITIVE_INFINITY);
  });

  it('copies the caller’s scratch buffer rather than holding a reference to it', () => {
    const s = createRecordingSurface(10, 10);
    const scratch = XY([1, 2]);
    s.poly(scratch, 1, 0);
    scratch[0] = 99;
    expect(s.ops[0]?.xy).toEqual([1, 2]);
  });
});

describe('digest', () => {
  it('is eight hex digits and stable across calls', () => {
    const s = createRecordingSurface(10, 10);
    s.poly(XY([1, 2, 3, 4, 5, 6]), 3, rgba(1, 2, 3));
    expect(s.digest()).toMatch(/^[0-9a-f]{8}$/);
    expect(s.digest()).toBe(s.digest());
  });

  it('changes when any part of the draw does', () => {
    const draw = (fill: number, x: number): string => {
      const s = createRecordingSurface(10, 10);
      s.poly(XY([x, 2, 3, 4, 5, 6]), 3, fill);
      return s.digest();
    };
    const base = draw(rgba(1, 2, 3), 1);
    expect(draw(rgba(1, 2, 4), 1)).not.toBe(base);
    expect(draw(rgba(1, 2, 3), 2)).not.toBe(base);
  });

  it('is identical for two surfaces given the same calls — the golden property', () => {
    const one = createRecordingSurface(10, 10);
    const two = createRecordingSurface(64, 64, 3);
    for (const s of [one, two]) {
      s.begin(rgba(4, 4, 4));
      s.ellipse(1, 1, 2, 2, rgba(7, 7, 7));
      s.text('sign', 0, 0, DEFAULT_TEXT, rgba(0, 0, 0));
    }
    expect(one.digest()).toBe(two.digest());
  });

  it('resets', () => {
    const s = createRecordingSurface(10, 10);
    const empty = s.digest();
    s.poly(XY([1, 2, 3, 4, 5, 6]), 3, 1);
    expect(s.digest()).not.toBe(empty);
    s.reset();
    expect(s.ops).toHaveLength(0);
    expect(s.digest()).toBe(empty);
    expect(s.alpha(1)).toBe(1);
  });
});

describe('render targets', () => {
  it('are recording surfaces too, carrying their mode', () => {
    const s = createRecordingSurface(100, 80, 2);
    const image = s.createTarget(50, 40) as RecordingTarget;
    const light = s.createTarget(50, 40, 'light') as RecordingTarget;
    expect(image.kind).toBe('recording');
    expect(image.mode).toBe('image');
    expect(light.mode).toBe('light');
    // A target inherits the parent's ratio: a half-resolution light buffer is a smaller target,
    // not a coarser one, and confusing the two doubles the memory it was created to save.
    expect(image.pixelRatio).toBe(2);
    expect(image.bitmap.width).toBe(50);
    expect(image.bitmap.height).toBe(40);
    expect(image.bitmap.pixelRatio).toBe(2);
    expect(image.bitmap.bytes).toBe(100 * 80 * 4);
  });

  it('refuses a zero-sized target', () => {
    const s = createRecordingSurface(100, 80);
    expect(() => s.createTarget(0, 40)).toThrow(/width/);
    expect(() => s.createTarget(40, 0)).toThrow(/height/);
  });

  it('fold their digest into the parent through the blit that draws them', () => {
    // What stops a cached or composited image from vanishing behind an opaque handle: the
    // parent's digest covers the child's contents.
    const s = createRecordingSurface(100, 80);
    const target = s.createTarget(50, 40) as RecordingTarget;
    target.begin(0);
    target.ellipse(1, 1, 2, 2, rgba(1, 2, 3));
    target.end();
    s.blit(target.bitmap, 3, 4, 50, 40, 'cut');
    expect(s.ops[0]?.op).toBe('blit');
    expect(s.ops[0]?.xy).toEqual([3, 4, 50, 40]);
    expect(s.ops[0]?.value).toBe(50);
    expect(s.ops[0]?.text).toBe(`cut ${target.digest()}`);
  });

  it('default the blit mode to over, and name a foreign bitmap rather than pretending', () => {
    const s = createRecordingSurface(100, 80);
    const foreign = createRecordingSurface(10, 10).createTarget(4, 4);
    s.blit(foreign.bitmap, 0, 0, 4, 4);
    expect(s.ops[0]?.text).toMatch(/^over /);
    const alien = { width: 1, height: 1, pixelRatio: 1, bytes: 4, dispose: (): void => undefined };
    s.blit(alien, 0, 0, 1, 1);
    expect(s.ops[1]?.text).toBe('over external');
  });

  it('dispose is a no-op, because the log is the image', () => {
    const s = createRecordingSurface(10, 10);
    expect(() => s.createTarget(4, 4).bitmap.dispose()).not.toThrow();
  });
});

describe('measure', () => {
  it('estimates, and says so through an exported ratio', () => {
    const s = createRecordingSurface(10, 10);
    expect(ESTIMATED_ADVANCE_RATIO).toBe(0.55);
    expect(s.measure('abcd', DEFAULT_TEXT)).toBe(4 * 12 * 0.55);
    expect(s.measure('', DEFAULT_TEXT)).toBe(0);
  });
});
