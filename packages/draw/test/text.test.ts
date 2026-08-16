/**
 * Text, and the two corrections that both shipped wrong once.
 *
 * The wall's basis vectors have different screen lengths, so a transform built from them raw is
 * anisotropic and every glyph comes out stretched sideways. Squeezing the along-axis fixes the
 * letterform — and moves the anchor with it, which is the second bug and the one that looks like
 * a layout problem rather than a transform problem.
 *
 * Both are asserted here on the transform itself, because `measure` differs between backends and
 * a test that asserted glyph positions would be a flaky golden by construction.
 */

import { describe, expect, it } from 'vitest';
import { rgba } from '../src/color.js';
import { DEFAULT_TEXT, MIN_WALL_TEXT_PX, screenText, wallText } from '../src/text.js';
import { firstOp, scene } from './harness.js';

/** The scale the transform applies along each of its two axes. */
function basisLengths(xy: readonly number[]): { along: number; down: number } {
  const a = xy[6] ?? 0;
  const b = xy[7] ?? 0;
  const c = xy[8] ?? 0;
  const d = xy[9] ?? 0;
  return { along: Math.sqrt(a * a + b * b), down: Math.sqrt(c * c + d * d) };
}

describe('wallText', () => {
  it('records the string, the transform and the resolved color', () => {
    const { surface, pen, palette } = scene({ zoom: 2 });
    wallText(pen, 0, 0, 3, 0, 3, 1.5, 'ACME', 'ink');
    const op = firstOp(surface, 'text');
    expect(op.text).toBe('ACME');
    expect(op.colors[0]).toBe(palette.get('ink'));
    expect(op.xy).toHaveLength(12);
  });

  it('normalizes both basis columns, so a glyph is sheared and never stretched', () => {
    // The whole of corrections one and two, applied at once. A raw parameter-space basis would
    // scale x by the segment's screen length and y by the band's, and no two of those agree.
    for (const [wallW, height] of [
      [4, 0.6],
      [0.4, 3],
      [2, 2],
    ] as const) {
      const { surface, pen } = scene({ zoom: 2 });
      wallText(pen, 0, 0, wallW, 0, 4, height, 'ACME', 'ink');
      const { along, down } = basisLengths(firstOp(surface, 'text').xy);
      expect(along).toBeCloseTo(1, 2);
      expect(down).toBeCloseTo(1, 2);
    }
  });

  it('keeps the down axis screen-vertical, so a sign never leans', () => {
    const { surface, pen } = scene({ zoom: 2 });
    wallText(pen, 0, 0, 4, 0, 3, 1.5, 'ACME', 'ink');
    const op = firstOp(surface, 'text');
    expect(op.xy[8]).toBe(0);
    expect(Math.abs(op.xy[9] ?? 0)).toBeCloseTo(1, 6);
  });

  it('anchors at the middle of the board, in screen lengths — correction two', () => {
    // The anchor is a screen length, not a parameter. Given in parameter space it would be
    // scaled by the transform a second time and the sign would slide off its own board.
    const { surface, pen, camera } = scene({ zoom: 2, snap: false });
    wallText(pen, 0, 0, 4, 0, 3, 1.5, 'ACME', 'ink');
    const op = firstOp(surface, 'text');
    const anchorX = (op.xy[6] ?? 0) * (op.xy[0] ?? 0) + (op.xy[10] ?? 0);
    const anchorY =
      (op.xy[7] ?? 0) * (op.xy[0] ?? 0) + (op.xy[9] ?? 0) * (op.xy[1] ?? 0) + (op.xy[11] ?? 0);
    // The segment runs from grid (0,0) to (4,0) at the top of the band; its screen midpoint is
    // grid (2,0), and the anchor sits half the band's height below it.
    // Within a pixel, not within a float: the recorded transform is rounded to three decimals
    // and is then multiplied by an anchor of a hundred and forty pixels.
    const midX = camera.toScreenX((2 - 0) * 32);
    expect(anchorX).toBeCloseTo(midX, 0);
    const topY = camera.toScreenY((2 + 0) * 16 - 26 * 3);
    const bandPx = camera.zoom * 26 * 1.5;
    expect(anchorY).toBeCloseTo(topY + bandPx / 2, 0);
  });

  it('shrinks to fit rather than overrunning the segment', () => {
    const { surface, pen } = scene({ zoom: 2 });
    wallText(pen, 0, 0, 3, 0, 3, 1.5, 'A', 'ink');
    const roomy = firstOp(surface, 'text').value;
    surface.reset();
    wallText(pen, 0, 0, 3, 0, 3, 1.5, 'A VERY LONG COMPANY NAME INDEED', 'ink');
    expect(firstOp(surface, 'text').value).toBeLessThan(roomy);
  });

  it('draws nothing at all when the band is illegible', () => {
    // A zoomed-out campus growing a rash of gray smears reads as a rendering artifact, not as
    // text that is too small.
    const { surface, pen } = scene({ zoom: 0.1 });
    wallText(pen, 0, 0, 4, 0, 3, 0.4, 'ACME', 'ink');
    expect(surface.ops).toHaveLength(0);
    expect(MIN_WALL_TEXT_PX).toBe(12);
  });

  it('draws nothing for an empty string or a zero-length segment', () => {
    const { surface, pen } = scene({ zoom: 3 });
    wallText(pen, 0, 0, 4, 0, 3, 1.5, '', 'ink');
    wallText(pen, 1, 1, 1, 1, 3, 1.5, 'ACME', 'ink');
    expect(surface.ops).toHaveLength(0);
  });

  it('handles a band given upside down, because a caller will eventually pass one', () => {
    const { surface, pen } = scene({ zoom: 3 });
    wallText(pen, 0, 0, 4, 0, 1, -2, 'ACME', 'ink');
    expect(surface.ops).toHaveLength(1);
  });

  it('centers regardless of the style handed in, and keeps the caller’s weight and family', () => {
    const { surface, pen } = scene({ zoom: 3 });
    wallText(pen, 0, 0, 4, 0, 3, 1.5, 'ACME', 'ink', {
      size: 99,
      weight: 300,
      family: 'serif',
      align: -1,
      baseline: 1,
    });
    const op = firstOp(surface, 'text');
    expect(op.xy[3]).toBe(300);
    expect(op.xy[4]).toBe(0);
    expect(op.xy[5]).toBe(0);
    // The size comes from the wall, not from the style: a sign is as tall as the board it is on.
    expect(op.value).not.toBe(99);
  });
});

describe('screenText', () => {
  it('draws unsheared at a screen pixel, with the default style', () => {
    const { surface, pen, palette } = scene();
    screenText(pen, 40, 50, '+12', 'warn');
    const op = firstOp(surface, 'text');
    expect(op.xy).toEqual([40, 50, DEFAULT_TEXT.size, DEFAULT_TEXT.weight, 0, 0]);
    expect(op.colors[0]).toBe(palette.get('warn'));
    expect(op.text).toBe('+12');
  });

  it('takes a style and a packed color', () => {
    const { surface, pen } = scene();
    screenText(pen, 0, 0, 'x', rgba(1, 2, 3), {
      size: 20,
      weight: 900,
      family: 'monospace',
      align: 1,
      baseline: -1,
    });
    const op = firstOp(surface, 'text');
    expect(op.xy).toEqual([0, 0, 20, 900, 1, -1]);
    expect(op.colors[0]).toBe(rgba(1, 2, 3));
  });
});
