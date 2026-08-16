/**
 * Grounding, and the full-frame dim.
 *
 * The contact shadow is the single load-bearing call in the kit's look: without it buildings
 * look pasted onto the grass and no amount of detail on the buildings fixes it. It is also the
 * one primitive drawn once per building per frame, which is why it is a `softEllipse` and not a
 * blurred copy of a silhouette.
 */

import { HALF_W } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import { SHADE_TINT, rgba, withAlpha } from '../src/color.js';
import { contactShadow, wash } from '../src/shadow.js';
import { firstOp, scene } from './harness.js';

describe('contactShadow', () => {
  it('is one soft ellipse, 2:1, centred on the footprint', () => {
    const { surface, pen } = scene({ snap: false });
    contactShadow(pen, 0, 0, 2, 2);
    expect(surface.ops).toHaveLength(1);
    const op = firstOp(surface, 'softEllipse');
    expect(op.xy[3]).toBeCloseTo((op.xy[2] ?? 0) / 2, 6);
    // A 2×2 footprint centred at (1,1) sits at world x 0, which is the centre of the viewport.
    expect(op.xy[0]).toBeCloseTo(200, 6);
  });

  it('spreads a little past the footprint and grows with it', () => {
    const { surface, pen } = scene();
    contactShadow(pen, 0, 0, 2, 2);
    const small = firstOp(surface, 'softEllipse').xy[2] as number;
    expect(small).toBeGreaterThan(2 * HALF_W);
    surface.reset();
    contactShadow(pen, 0, 0, 4, 4);
    expect(firstOp(surface, 'softEllipse').xy[2] as number).toBeGreaterThan(small);
  });

  it('fades from a cool tint at the centre to nothing at the rim', () => {
    const { surface, pen } = scene();
    contactShadow(pen, 0, 0, 1, 1);
    const op = firstOp(surface, 'softEllipse');
    expect((op.colors[0] ?? 0) >>> 8).toBe(SHADE_TINT >>> 8);
    expect(op.colors[1]).toBe(withAlpha(SHADE_TINT, 0));
  });

  it('scales with strength, clamps above one, and draws nothing at or below zero', () => {
    const { surface, pen } = scene();
    contactShadow(pen, 0, 0, 1, 1, 0.5);
    const half = (firstOp(surface, 'softEllipse').colors[0] ?? 0) & 255;
    surface.reset();
    contactShadow(pen, 0, 0, 1, 1, 1);
    const full = (firstOp(surface, 'softEllipse').colors[0] ?? 0) & 255;
    expect(full).toBeGreaterThan(half);
    surface.reset();
    contactShadow(pen, 0, 0, 1, 1, 9);
    expect((firstOp(surface, 'softEllipse').colors[0] ?? 0) & 255).toBe(full);
    surface.reset();
    contactShadow(pen, 0, 0, 1, 1, 0);
    contactShadow(pen, 0, 0, 1, 1, -1);
    expect(surface.ops).toHaveLength(0);
  });

  it('scales with the zoom, like everything else lying on the ground', () => {
    const { surface, pen } = scene({ zoom: 2 });
    contactShadow(pen, 0, 0, 2, 2);
    const zoomed = firstOp(surface, 'softEllipse').xy[2] as number;
    const flat = scene({ zoom: 1 });
    contactShadow(flat.pen, 0, 0, 2, 2);
    expect(zoomed).toBeCloseTo((firstOp(flat.surface, 'softEllipse').xy[2] as number) * 2, 6);
  });
});

describe('wash', () => {
  it('covers the whole surface in screen space, regardless of where the world is', () => {
    const { surface, pen, camera } = scene({ width: 320, height: 200, snap: true });
    camera.centerOn(917.3, -412.9);
    wash(pen, 'night');
    const op = firstOp(surface, 'poly');
    expect(op.value).toBe(4);
    expect(op.xy).toEqual([0, 0, 320, 0, 320, 200, 0, 200]);
  });

  it('resolves an Ink like every other primitive', () => {
    const { surface, pen, palette } = scene();
    wash(pen, 'night');
    expect(firstOp(surface, 'poly').colors[0]).toBe(palette.get('night'));
    surface.reset();
    wash(pen, rgba(1, 2, 3, 4));
    expect(firstOp(surface, 'poly').colors[0]).toBe(rgba(1, 2, 3, 4));
  });
});
