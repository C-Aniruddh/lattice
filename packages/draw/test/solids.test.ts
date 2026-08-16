/**
 * The solid kit, and the one assertion in this package that no other package can make.
 *
 * **The six-point silhouette contract.** `iso.boxSilhouette` is the definition and `isoBox` is
 * the conformer. Reverse the winding or start at a different corner and the painted outline
 * still looks perfect — it is the same hexagon — while the *hit polygon* is a different hexagon
 * and taps land on the wrong building near the edges. Nothing in `iso` can see that, and nothing
 * in `draw` can see it either; the only thing that can is a test that puts the two side by side.
 * `iso`'s half already exists in its own suite, derived from `gridToScreen` rather than from its
 * implementation, so this half can assert against `boxSilhouette` directly.
 */

import { createRng } from '@lattice/core';
import { HALF_H, HALF_W, boxSilhouette, createCamera } from '@lattice/iso';
import type { Volume } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import { FACE_LEFT, FACE_RIGHT, outlineOf, rgba, shade, withAlpha } from '../src/color.js';
import {
  GHOST_LIFT,
  GROUND_LIFT,
  LEVEL_H,
  SELECT_LIFT,
  glowDot,
  isoBox,
  isoCylinder,
  isoPatch,
  isoPost,
  isoRoof,
  isoTile,
  isoWall,
  levelsToPx,
} from '../src/solids.js';
import { firstOp, opsOf, scene } from './harness.js';

/** The same rounding the recording backend applies, so an expectation and an op compare exactly
 *  rather than nearly. */
function r3(value: number): number {
  const scaled = Math.round(value * 1000) / 1000;
  return scaled === 0 ? 0 : scaled;
}

describe('heights', () => {
  it('LEVEL_H is 26 and levelsToPx is the only conversion', () => {
    // 26 rather than 32 on purpose: a storey exactly one tile tall makes every building a cube.
    expect(LEVEL_H).toBe(26);
    expect(levelsToPx(3)).toBe(78);
    expect(levelsToPx(0)).toBe(0);
    expect(levelsToPx(-1)).toBe(-26);
  });

  it('the z-fight ladder is ordered and non-zero', () => {
    expect(GROUND_LIFT).toBeGreaterThan(0);
    expect(GHOST_LIFT).toBeGreaterThan(GROUND_LIFT);
    expect(SELECT_LIFT).toBeGreaterThan(GHOST_LIFT);
  });
});

describe('isoBox — the silhouette contract with iso', () => {
  it('strokes exactly the six points boxSilhouette returns, in order, for 100 random cases', () => {
    const rng = createRng('silhouette-contract');
    const buffer = new Float64Array(12);
    for (let i = 0; i < 100; i++) {
      const zoom = rng.float(0.5, 3);
      const camera = createCamera(rng.float(200, 900), rng.float(200, 900), {
        zoom,
        bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
      });
      camera.centerOn(rng.float(-800, 800), rng.float(-800, 800));

      const gx = rng.float(-20, 20);
      const gy = rng.float(-20, 20);
      const w = rng.float(0.5, 6);
      const d = rng.float(0.5, 6);
      const inset = rng.float(0, Math.min(w, d) / 3);
      const h = rng.float(0.25, 8);
      const z = rng.float(0, 4);

      const { surface, pen } = scene({ snap: false });
      // The same camera on both sides: the pen's own camera is replaced so that the stroke and
      // the silhouette are computed from one transform and any disagreement is the point order.
      const framePen = { ...pen, camera };
      isoBox(framePen, gx, gy, w, d, { color: 'brand', h, z, inset });

      const volume: Volume = {
        ox: inset,
        oy: inset,
        w: w - 2 * inset,
        d: d - 2 * inset,
        zPx: levelsToPx(z),
        hPx: levelsToPx(h),
      };
      boxSilhouette(camera, gx, gy, volume, buffer);

      const stroke = firstOp(surface, 'stroke');
      expect(stroke.value).toBe(1);
      expect(stroke.text).toBe('closed');
      expect(stroke.xy).toHaveLength(12);
      for (let k = 0; k < 12; k++) {
        expect(stroke.xy[k]).toBe(r3(buffer[k] ?? Number.NaN));
      }
    }
  });

  it('names the six points as north-top, east-top, east-base, south-base, west-base, west-top', () => {
    // The order stated as a shape rather than as a buffer comparison, so a reader can see what
    // the contract above is actually asserting.
    const { surface, pen } = scene({ snap: false });
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1 });
    const xy = firstOp(surface, 'stroke').xy;
    const [xN, yN, xE, yET, xE2, yEB, xS, ySB, xW, yWB, xW2, yWT] = xy as number[];
    expect(xE).toBe(xE2);
    expect(xW).toBe(xW2);
    // East is right of north, west is left of it, south sits between them and lower down.
    expect(xE as number).toBeGreaterThan(xN as number);
    expect(xW as number).toBeLessThan(xN as number);
    expect(xS as number).toBeGreaterThan(xW as number);
    expect(xS as number).toBeLessThan(xE as number);
    // Tops are above bases, and the north top is the highest point of the whole outline.
    expect(yET as number).toBeLessThan(yEB as number);
    expect(yWT as number).toBeLessThan(yWB as number);
    expect(yN as number).toBeLessThan(yET as number);
    expect(ySB as number).toBeGreaterThan(yEB as number);
  });
});

describe('isoBox', () => {
  it('strokes once around the silhouette, not once per face', () => {
    // Per-face strokes cross-hatch the interior and destroy the chunky read that makes this art
    // style work at thumbnail size.
    const { surface, pen } = scene();
    isoBox(pen, 0, 0, 2, 2, { color: 'brand', h: 2 });
    expect(opsOf(surface, 'stroke')).toHaveLength(1);
    expect(opsOf(surface, 'poly')).toHaveLength(3);
  });

  it('draws no stroke at all when outline is false — for stacked sub-volumes', () => {
    const { surface, pen } = scene();
    isoBox(pen, 0, 0, 2, 2, { color: 'brand', h: 2, outline: false });
    expect(opsOf(surface, 'stroke')).toHaveLength(0);
    expect(opsOf(surface, 'poly')).toHaveLength(3);
  });

  it('derives left, right and top from one colour, lit front-left', () => {
    const { surface, pen, palette } = scene();
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1 });
    const polys = opsOf(surface, 'poly');
    const brand = palette.get('brand');
    expect(polys[0]?.colors[0]).toBe(shade(brand, FACE_LEFT));
    expect(polys[1]?.colors[0]).toBe(shade(brand, FACE_RIGHT));
    expect(polys[2]?.colors[0]).toBe(brand);
    expect(firstOp(surface, 'stroke').colors[0]).toBe(outlineOf(brand));
  });

  it('honours topColor — the one sanctioned per-face exception', () => {
    const { surface, pen, palette } = scene();
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1, topColor: 'glass' });
    expect(opsOf(surface, 'poly')[2]?.colors[0]).toBe(palette.get('glass'));
  });

  it('takes a packed colour as readily as a slot', () => {
    const { surface, pen } = scene();
    isoBox(pen, 0, 0, 1, 1, { color: rgba(10, 20, 30), h: 1 });
    expect(opsOf(surface, 'poly')[2]?.colors[0]).toBe(rgba(10, 20, 30));
  });

  it('sets and restores the alpha multiplier around a translucent solid', () => {
    // `alpha` sets and hands back the previous value; it does not compose. So a solid inside an
    // already-faded frame restores that frame's multiplier rather than resetting it to 1.
    const { surface, pen } = scene();
    pen.surface.alpha(0.8);
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1, alpha: 0.5 });
    expect(opsOf(surface, 'alpha').map((op) => op.value)).toEqual([0.8, 0.5, 0.8]);
  });

  it('touches the alpha multiplier at all only when it has to', () => {
    const { surface, pen } = scene();
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1 });
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1, alpha: 1 });
    expect(opsOf(surface, 'alpha')).toHaveLength(0);
  });

  it('shrinks the footprint by the inset on all sides', () => {
    const { surface, pen } = scene({ snap: false });
    isoBox(pen, 0, 0, 2, 2, { color: 'brand', h: 1 });
    const wide = firstOp(surface, 'stroke').xy;
    surface.reset();
    isoBox(pen, 0, 0, 2, 2, { color: 'brand', h: 1, inset: 0.25 });
    const narrow = firstOp(surface, 'stroke').xy;
    expect(narrow[4] as number).toBeLessThan(wide[4] as number);
    expect(narrow[8] as number).toBeGreaterThan(wide[8] as number);
  });

  it('sits a box on top of another when z is given', () => {
    const { surface, pen } = scene({ snap: false });
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1 });
    const ground = firstOp(surface, 'stroke').xy[1] as number;
    surface.reset();
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1, z: 2 });
    const raised = firstOp(surface, 'stroke').xy[1] as number;
    expect(ground - raised).toBeCloseTo(levelsToPx(2), 6);
  });

  it('refuses a NaN dimension rather than painting nothing and reporting nothing', () => {
    const { pen } = scene();
    expect(() => isoBox(pen, 0, 0, Number.NaN, 1, { color: 'brand', h: 1 })).toThrow(RangeError);
    expect(() => isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: Number.NaN })).toThrow(/isoBox/);
    expect(() => isoBox(pen, 0, 0, 1, Number.POSITIVE_INFINITY, { color: 'brand', h: 1 })).toThrow(
      RangeError,
    );
    expect(() => isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 1, z: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it('draws a zero-height box as two degenerate slivers — which is why isoPatch exists', () => {
    const { surface, pen } = scene();
    isoBox(pen, 0, 0, 1, 1, { color: 'brand', h: 0 });
    expect(opsOf(surface, 'poly')).toHaveLength(3);
  });
});

describe('isoTile and isoPatch', () => {
  it('draw one four-point diamond, and stroke only when asked', () => {
    const { surface, pen } = scene();
    isoTile(pen, 3, 4, 'ground');
    expect(opsOf(surface, 'poly')).toHaveLength(1);
    expect(firstOp(surface, 'poly').value).toBe(4);
    expect(opsOf(surface, 'stroke')).toHaveLength(0);
    surface.reset();
    isoTile(pen, 3, 4, 'ground', 'ink');
    expect(opsOf(surface, 'stroke')).toHaveLength(1);
  });

  it('inset a tile on all sides, for a grid whose cells read as cells', () => {
    const { surface, pen } = scene({ snap: false });
    isoTile(pen, 0, 0, 'ground');
    const full = firstOp(surface, 'poly').xy;
    surface.reset();
    isoTile(pen, 0, 0, 'ground', undefined, 0.2);
    const inset = firstOp(surface, 'poly').xy;
    expect(inset[2] as number).toBeLessThan(full[2] as number);
  });

  it('lift a tile off the ground by a storey fraction', () => {
    const { surface, pen } = scene({ snap: false });
    isoTile(pen, 0, 0, 'ground');
    const flat = firstOp(surface, 'poly').xy[1] as number;
    surface.reset();
    isoTile(pen, 0, 0, 'ground', undefined, 0, 1);
    expect(flat - (firstOp(surface, 'poly').xy[1] as number)).toBeCloseTo(LEVEL_H, 6);
  });

  it('isoPatch covers a whole footprint and refuses a NaN one', () => {
    const { surface, pen } = scene({ snap: false });
    isoPatch(pen, 0, 0, 3, 2, 1, 'glass', 'ink');
    expect(firstOp(surface, 'poly').value).toBe(4);
    expect(opsOf(surface, 'stroke')).toHaveLength(1);
    expect(() => isoPatch(pen, 0, 0, Number.NaN, 2, 0, 'glass')).toThrow(/isoPatch/);
  });
});

describe('isoWall', () => {
  it('spans two grid points and two heights, flush on the face', () => {
    const { surface, pen } = scene({ snap: false });
    isoWall(pen, 0, 0, 2, 0, 0.5, 1.5, 'glass', 'ink');
    const xy = firstOp(surface, 'poly').xy;
    expect(firstOp(surface, 'poly').value).toBe(4);
    // The two top corners are above the two base corners by exactly one storey.
    expect((xy[7] as number) - (xy[1] as number)).toBeCloseTo(LEVEL_H, 6);
    expect(opsOf(surface, 'stroke')).toHaveLength(1);
  });

  it('strokes only when asked', () => {
    const { surface, pen } = scene();
    isoWall(pen, 0, 0, 1, 0, 0, 1, 'glass');
    expect(opsOf(surface, 'stroke')).toHaveLength(0);
  });
});

describe('isoRoof', () => {
  it('draws far slope, gable and near slope, then one six-point outline', () => {
    const { surface, pen } = scene();
    isoRoof(pen, 0, 0, 3, 2, 2, 0.5, 'brand');
    expect(opsOf(surface, 'poly').map((op) => op.value)).toEqual([4, 3, 4]);
    const stroke = firstOp(surface, 'stroke');
    expect(stroke.value).toBe(1);
    expect(stroke.xy).toHaveLength(12);
  });

  it('drops the far slope once the ridge turns it away from the camera', () => {
    // Past `rise · LEVEL_H · 2 ≥ d · HALF_H` the ridge projects above the far eave; painting the
    // slope anyway puts a wedge of roof above the ridge line, which reads as a hole.
    const { surface, pen } = scene();
    isoRoof(pen, 0, 0, 3, 2, 0, 2, 'brand');
    expect(opsOf(surface, 'poly').map((op) => op.value)).toEqual([3, 4]);
    expect(2 * levelsToPx(2)).toBeGreaterThanOrEqual(2 * HALF_H);
  });

  it('lights the near slope more than the far one and the gable least of all', () => {
    const { surface, pen, palette } = scene();
    isoRoof(pen, 0, 0, 3, 2, 0, 0.4, 'brand');
    const polys = opsOf(surface, 'poly');
    const lum = (c: number): number => ((c >>> 24) & 255) + ((c >>> 16) & 255) + ((c >>> 8) & 255);
    expect(lum(polys[2]?.colors[0] ?? 0)).toBeGreaterThan(lum(polys[0]?.colors[0] ?? 0));
    expect(lum(polys[0]?.colors[0] ?? 0)).toBeGreaterThan(lum(polys[1]?.colors[0] ?? 0));
    expect(polys[1]?.colors[0]).toBe(shade(palette.get('brand'), FACE_RIGHT));
  });

  it('omits the outline when asked, and refuses a NaN rise', () => {
    const { surface, pen } = scene();
    isoRoof(pen, 0, 0, 3, 2, 0, 0.4, 'brand', false);
    expect(opsOf(surface, 'stroke')).toHaveLength(0);
    expect(() => isoRoof(pen, 0, 0, 3, 2, 0, Number.NaN, 'brand')).toThrow(/isoRoof/);
  });
});

describe('isoCylinder', () => {
  it('draws a base cap, a ramped body and a top cap, then one closed silhouette', () => {
    const { surface, pen } = scene();
    isoCylinder(pen, 2, 2, 0.8, { color: 'metal', h: 2 });
    expect(opsOf(surface, 'ellipse')).toHaveLength(2);
    expect(opsOf(surface, 'polyRamp')).toHaveLength(1);
    const stroke = firstOp(surface, 'stroke');
    expect(stroke.text).toBe('closed');
    // Two half-arcs plus their shared endpoints: the silhouette, not a rectangle.
    expect(stroke.xy.length).toBeGreaterThanOrEqual(36);
  });

  it('squashes every cap 2:1, at every zoom', () => {
    for (const zoom of [0.5, 1, 2.5]) {
      const { surface, pen } = scene({ zoom });
      isoCylinder(pen, 0, 0, 1, { color: 'metal', h: 1 });
      for (const op of opsOf(surface, 'ellipse')) {
        expect(op.xy[3]).toBeCloseTo((op.xy[2] ?? 0) / 2, 6);
      }
      expect(firstOp(surface, 'ellipse').xy[2]).toBeCloseTo(HALF_W * zoom, 6);
    }
  });

  it('ramps the body from the lit side to the shaded one', () => {
    const { surface, pen, palette } = scene();
    isoCylinder(pen, 0, 0, 1, { color: 'metal', h: 1 });
    const body = firstOp(surface, 'polyRamp');
    const metal = palette.get('metal');
    expect(body.colors).toEqual([shade(metal, FACE_LEFT), shade(metal, FACE_RIGHT)]);
  });

  it('honours topColor, inset, alpha and outline', () => {
    const { surface, pen, palette } = scene();
    isoCylinder(pen, 0, 0, 1, {
      color: 'metal',
      h: 1,
      topColor: 'glass',
      inset: 0.5,
      alpha: 0.4,
      outline: false,
    });
    const caps = opsOf(surface, 'ellipse');
    expect(caps[1]?.colors[0]).toBe(palette.get('glass'));
    expect(caps[0]?.xy[2]).toBeCloseTo(0.5 * HALF_W, 6);
    expect(opsOf(surface, 'stroke')).toHaveLength(0);
    expect(opsOf(surface, 'alpha').map((op) => op.value)).toEqual([0.4, 1]);
  });

  it('collapses a negative radius to zero rather than mirroring the shape', () => {
    const { surface, pen } = scene();
    isoCylinder(pen, 0, 0, 0.5, { color: 'metal', h: 1, inset: 2 });
    expect(firstOp(surface, 'ellipse').xy[2]).toBe(0);
  });

  it('refuses a NaN radius', () => {
    const { pen } = scene();
    expect(() => isoCylinder(pen, 0, 0, Number.NaN, { color: 'metal', h: 1 })).toThrow(
      /isoCylinder/,
    );
  });
});

describe('isoPost', () => {
  it('is a ramped upright quad spanning z to z + h', () => {
    const { surface, pen } = scene({ snap: false });
    isoPost(pen, 1, 1, 0, 3, 'metal');
    const op = firstOp(surface, 'polyRamp');
    expect(op.value).toBe(4);
    expect((op.xy[5] as number) - (op.xy[1] as number)).toBeCloseTo(levelsToPx(3), 6);
  });

  it('never thins below a pixel, however far out the camera is', () => {
    // A mast that disappears entirely at low zoom is a building that quietly loses its aerial.
    const { surface, pen } = scene({ zoom: 0.05 });
    isoPost(pen, 0, 0, 0, 3, 'metal', 0.01);
    const op = firstOp(surface, 'polyRamp');
    expect((op.xy[2] as number) - (op.xy[0] as number)).toBeGreaterThanOrEqual(1.5);
  });

  it('widens with the width argument', () => {
    const { surface, pen } = scene({ zoom: 2 });
    isoPost(pen, 0, 0, 0, 1, 'metal', 0.5);
    const wide = firstOp(surface, 'polyRamp');
    expect((wide.xy[2] as number) - (wide.xy[0] as number)).toBeCloseTo(0.5 * HALF_W * 2, 6);
  });
});

describe('glowDot', () => {
  it('is a hard core inside a soft halo, and round rather than squashed', () => {
    // Round on purpose: this is a light source in the air seen head-on. A ground-plane pool —
    // `LightField.add` — is the flat thing, and it is 2:1.
    const { surface, pen } = scene();
    glowDot(pen, 1, 1, 2, 'warn');
    const halo = firstOp(surface, 'softEllipse');
    const core = firstOp(surface, 'ellipse');
    expect(halo.xy[2]).toBe(halo.xy[3]);
    expect(core.xy[2]).toBe(core.xy[3]);
    expect(halo.xy[2] as number).toBeGreaterThan(core.xy[2] as number);
    expect(halo.colors[1]).toBe(withAlpha(halo.colors[0] ?? 0, 0));
  });

  it('fades with intensity and draws nothing at all at zero', () => {
    const { surface, pen } = scene();
    glowDot(pen, 1, 1, 2, 'warn', 0.2, 0.5);
    const dim = (firstOp(surface, 'ellipse').colors[0] ?? 0) & 255;
    surface.reset();
    glowDot(pen, 1, 1, 2, 'warn', 0.2, 1);
    expect((firstOp(surface, 'ellipse').colors[0] ?? 0) & 255).toBeGreaterThan(dim);
    surface.reset();
    glowDot(pen, 1, 1, 2, 'warn', 0.2, 0);
    glowDot(pen, 1, 1, 2, 'warn', 0.2, -1);
    expect(surface.ops).toHaveLength(0);
  });

  it('clamps an over-driven intensity rather than wrapping the alpha', () => {
    const { surface, pen } = scene();
    glowDot(pen, 1, 1, 2, 'warn', 0.2, 40);
    expect((firstOp(surface, 'ellipse').colors[0] ?? 0) & 255).toBe(255);
  });

  it('scales its radius with the zoom', () => {
    const { surface, pen } = scene({ zoom: 3 });
    glowDot(pen, 0, 0, 0, 'warn', 0.5);
    expect(firstOp(surface, 'ellipse').xy[2]).toBeCloseTo(0.5 * HALF_W * 3, 6);
  });
});

describe('the snap', () => {
  it('shifts every coordinate uniformly, so no geometric relationship changes', () => {
    const { surface, pen } = scene({ snap: false });
    isoBox(pen, 1, 2, 2, 2, { color: 'brand', h: 2 });
    const loose = firstOp(surface, 'stroke').xy;
    const snapped = scene({ snap: true, pixelRatio: 2 });
    snapped.camera.centerOn(3.37, -11.19);
    isoBox(snapped.pen, 1, 2, 2, 2, { color: 'brand', h: 2 });
    const tight = firstOp(snapped.surface, 'stroke').xy;
    const dx = (tight[0] ?? 0) - (loose[0] ?? 0);
    const dy = (tight[1] ?? 0) - (loose[1] ?? 0);
    for (let i = 0; i < 12; i += 2) {
      expect(tight[i]).toBeCloseTo((loose[i] ?? 0) + dx, 2);
      expect(tight[i + 1]).toBeCloseTo((loose[i + 1] ?? 0) + dy, 2);
    }
  });
});
