/**
 * How a game composes primitives into a building it owns.
 *
 * The property under test throughout is that a massing has **no channel through which unkeyed
 * state can reach the art**: no surface, no clock, and a stream the kit rewinds from `v.seed`
 * before every call. If any of that leaks, a rack reshuffles its LEDs on reload and a replay
 * from a seed stops landing on the same pixel — both silent, both unreproducible.
 *
 * The measuring replay is the other half. `spriteBounds`, `spriteVolume` and `spriteHeightPx`
 * are derived from the massing rather than guessed, which is the only way they stay right when
 * a sprite grows a mast at level 3.
 */

import type { Vec2 } from '@lattice/core';
import { boxSilhouette, gridToScreen, pointInPolygon } from '@lattice/iso';
import type { Rect, Volume } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import { rgba } from '../src/color.js';
import { createLightField } from '../src/light.js';
import { LEVEL_H, SELECT_LIFT, levelsToPx } from '../src/solids.js';
import {
  FLAG_BUILDING,
  FLAG_GHOST,
  FLAG_POWERED,
  FLAG_SELECTED,
  VARIANT_ZERO,
  defineSprite,
  drawFootprint,
  drawGhost,
  drawSprite,
  spriteBounds,
  spriteHeightPx,
  spriteVolume,
} from '../src/sprite.js';
import type { SpriteDef, Variant } from '../src/sprite.js';
import { firstOp, opsOf, scene } from './harness.js';

/** A tower that exercises every writer method, and branches on level so the measuring replay
 *  has something to disagree with the drawing one about. */
const TOWER: SpriteDef = defineSprite({
  id: 'tower',
  w: 2,
  d: 2,
  massing(s, v, rng) {
    s.shadow(0, 0, 2, 2);
    s.tile(0, 0, 'ground', 'ink', 0.05, 0.002);
    s.patch(0, 0, 2, 2, 0.01, 'metal');
    s.box(0, 0, 2, 2, { color: 'brand', h: 3 });
    s.wall(0, 0, 2, 0, 1, 2, 'glass');
    s.roof(0, 0, 2, 2, 3, 0.5, 'metal');
    s.cylinder(1, 1, 0.4, { color: 'metal', h: 0.6, z: 3.5 });
    if (v.level > 2) s.post(1, 1, 4.1, 2, 'metal');
    s.glow(0.4, 0.4, 3.2, 'warn', 0.1, rng.next());
    if (v.label !== '') s.sign(0, 0, 2, 0, 3, 0.9, v.label, 'ink');
  },
  animate(pen, gx, gy, v, rng) {
    void v;
    void rng;
    void gx;
    void gy;
    void pen;
  },
});

/** The smallest thing that can be drawn: a single box. */
const SHED: SpriteDef = defineSprite({
  id: 'shed',
  w: 1,
  d: 1,
  massing(s) {
    s.box(0, 0, 1, 1, { color: 'brand', h: 1 });
  },
});

const variant = (over: Partial<Variant>): Variant => ({ ...VARIANT_ZERO, ...over });

describe('Variant and the flags', () => {
  it('VARIANT_ZERO is a finished, powered, unnamed instance', () => {
    expect(VARIANT_ZERO).toEqual({ level: 1, seed: 0, flags: FLAG_POWERED, progress: 1, label: '' });
    expect(Object.isFrozen(VARIANT_ZERO)).toBe(true);
  });

  it('the flags are distinct bits, so a bitfield means what it says', () => {
    expect([FLAG_POWERED, FLAG_BUILDING, FLAG_SELECTED, FLAG_GHOST]).toEqual([1, 2, 4, 8]);
  });
});

describe('defineSprite', () => {
  it('is identity — it exists only to type the literal at the call site', () => {
    expect(defineSprite(SHED)).toBe(SHED);
  });
});

describe('drawSprite', () => {
  it('replays every writer method onto the pen', () => {
    const { surface, pen } = scene({ zoom: 2 });
    drawSprite(pen, TOWER, 3, 4, variant({ label: 'ACME' }));
    expect(opsOf(surface, 'poly').length).toBeGreaterThan(6);
    expect(opsOf(surface, 'softEllipse').length).toBeGreaterThanOrEqual(2);
    expect(opsOf(surface, 'ellipse').length).toBeGreaterThanOrEqual(3);
    expect(opsOf(surface, 'polyRamp').length).toBeGreaterThanOrEqual(1);
    expect(opsOf(surface, 'text')).toHaveLength(1);
    expect(firstOp(surface, 'text').text).toBe('ACME');
  });

  it('offsets the massing to the grid position it is drawn at', () => {
    const { surface, pen } = scene({ snap: false });
    drawSprite(pen, SHED, 0, 0, VARIANT_ZERO);
    const origin = firstOp(surface, 'stroke').xy[0] as number;
    surface.reset();
    drawSprite(pen, SHED, 4, 4, VARIANT_ZERO);
    // Four tiles along both axes cancel on screen x and move only down the screen.
    expect(firstOp(surface, 'stroke').xy[0]).toBeCloseTo(origin, 6);
    surface.reset();
    drawSprite(pen, SHED, 4, 0, VARIANT_ZERO);
    expect(firstOp(surface, 'stroke').xy[0] as number).toBeGreaterThan(origin);
  });

  it('branches on the variant, in the art and in the measurement alike', () => {
    const { surface, pen } = scene();
    drawSprite(pen, TOWER, 0, 0, variant({ level: 1 }));
    const plain = surface.ops.length;
    surface.reset();
    drawSprite(pen, TOWER, 0, 0, variant({ level: 3 }));
    expect(surface.ops.length).toBeGreaterThan(plain);
    expect(spriteHeightPx(TOWER, variant({ level: 3 }))).toBeGreaterThan(
      spriteHeightPx(TOWER, variant({ level: 1 })),
    );
  });

  it('is deterministic: the same sprite and variant digest identically', () => {
    const a = scene();
    const b = scene();
    drawSprite(a.pen, TOWER, 2, 3, variant({ seed: 77, label: 'X' }));
    drawSprite(b.pen, TOWER, 2, 3, variant({ seed: 77, label: 'X' }));
    expect(a.surface.digest()).toBe(b.surface.digest());
  });

  it('varies with the seed, and the same seed never drifts across repeats', () => {
    const digest = (seed: number, repeats: number): string => {
      const { surface, pen } = scene();
      for (let i = 0; i < repeats; i++) {
        surface.reset();
        drawSprite(pen, TOWER, 0, 0, variant({ seed }));
      }
      return surface.digest();
    };
    expect(digest(1, 1)).not.toBe(digest(2, 1));
    // Ten redraws of one instance: the stream is rewound each time, so the tenth frame is the
    // first frame. Without the rewind a rack reshuffles its LEDs as the game runs.
    expect(digest(1, 10)).toBe(digest(1, 1));
  });

  it('gives each hook its own stream, so adding a draw to one cannot reshuffle another', () => {
    const seen: number[] = [];
    const def = defineSprite({
      id: 'streams',
      w: 1,
      d: 1,
      massing: (_s, _v, rng) => void seen.push(rng.next()),
      animate: (_p, _gx, _gy, _v, rng) => void seen.push(rng.next()),
      emit: (_f, _gx, _gy, _v, rng) => void seen.push(rng.next()),
    });
    const { surface, pen } = scene();
    const light = createLightField(surface);
    const framePen = { ...pen, light };
    light.begin(framePen, 1, 'night');
    drawSprite(framePen, def, 0, 0, variant({ seed: 5 }));
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it('runs emit only when the frame has an active light field', () => {
    // A game in daylight pays nothing for a campus full of lamps.
    let emitted = 0;
    const lamp = defineSprite({
      id: 'lamp',
      w: 1,
      d: 1,
      massing: () => undefined,
      emit: (field, gx, gy) => {
        emitted += 1;
        field.add(gx, gy, 0, 3, 1, 'warn');
      },
    });
    const { surface, pen } = scene();
    drawSprite(pen, lamp, 0, 0, VARIANT_ZERO);
    expect(emitted).toBe(0);

    const field = createLightField(surface);
    const framePen = { ...pen, light: field };
    field.begin(framePen, 0, 'night');
    drawSprite(framePen, lamp, 0, 0, VARIANT_ZERO);
    expect(emitted).toBe(0);

    field.begin(framePen, 0.9, 'night');
    drawSprite(framePen, lamp, 0, 0, VARIANT_ZERO);
    expect(emitted).toBe(1);
    expect(field.count).toBe(1);
  });

  it('drops its stream table rather than growing without bound', () => {
    // Bounded by the number of distinct instances a game draws, which is a few hundred. Past
    // that, something is generating seeds per frame, and an unbounded map would be a leak
    // wearing a cache's name — so the table is dropped and rebuilt over the next frame.
    const { surface, pen } = scene();
    for (let seed = 0; seed < 5000; seed++) {
      surface.reset();
      drawSprite(pen, SHED, 0, 0, variant({ seed }));
    }
    surface.reset();
    drawSprite(pen, SHED, 0, 0, variant({ seed: 7 }));
    const after = surface.digest();
    surface.reset();
    drawSprite(pen, SHED, 0, 0, variant({ seed: 7 }));
    // …and rebuilding it changes nothing: a stream's identity is its seed, not its slot.
    expect(surface.digest()).toBe(after);
  });

  it('does not leak its writer when a massing throws', () => {
    // The pooled writer is released in a `finally`, so a sprite that throws once does not shift
    // every later sprite one level deeper for the rest of the process.
    const bad = defineSprite({
      id: 'bad',
      w: 1,
      d: 1,
      massing: () => {
        throw new Error('massing failed');
      },
    });
    const { surface, pen } = scene();
    expect(() => drawSprite(pen, bad, 0, 0, VARIANT_ZERO)).toThrow('massing failed');
    surface.reset();
    drawSprite(pen, SHED, 0, 0, VARIANT_ZERO);
    expect(opsOf(surface, 'poly')).toHaveLength(3);
  });

  it('lets a massing read the frame’s live palette', () => {
    const { surface, pen, palette } = scene();
    palette.set('brand', rgba(3, 4, 5));
    const reader = defineSprite({
      id: 'reader',
      w: 1,
      d: 1,
      massing: (s) => s.box(0, 0, 1, 1, { color: s.palette.get('brand'), h: 1 }),
    });
    drawSprite(pen, reader, 0, 0, VARIANT_ZERO);
    expect(opsOf(surface, 'poly')[2]?.colors[0]).toBe(rgba(3, 4, 5));
  });
});

describe('drawGhost', () => {
  it('tints every fill by legality and fades the whole thing', () => {
    const { surface, pen, palette } = scene();
    drawGhost(pen, TOWER, 0, 0, VARIANT_ZERO, true);
    const ok = palette.get('ok');
    for (const op of opsOf(surface, 'poly')) {
      // Every fill derives from the legality slot rather than from the sprite's own colors.
      expect(op.colors[0]).not.toBe(palette.get('brand'));
    }
    // The top face is the legality slot undiluted; the sides are derived from it, as they are
    // derived from a real color, so the ghost still reads as a solid rather than as a decal.
    expect(opsOf(surface, 'poly').map((op) => op.colors[0])).toContain(ok);
    const alphas = opsOf(surface, 'alpha');
    expect(alphas[0]?.value).toBeLessThan(1);
    expect(alphas[alphas.length - 1]?.value).toBe(1);
  });

  it('uses the bad slot when it will not land', () => {
    const { surface, pen, palette } = scene();
    drawGhost(pen, SHED, 0, 0, VARIANT_ZERO, false);
    expect(opsOf(surface, 'poly')[2]?.colors[0]).toBe(palette.get('bad'));
  });

  it('casts no shadow — a shadow under a preview is the part that reads as real', () => {
    const { surface, pen } = scene();
    drawGhost(pen, TOWER, 0, 0, VARIANT_ZERO, true);
    const solid = scene();
    drawSprite(solid.pen, TOWER, 0, 0, VARIANT_ZERO);
    expect(opsOf(surface, 'softEllipse').length).toBeLessThan(
      opsOf(solid.surface, 'softEllipse').length,
    );
  });

  it('runs neither animate nor emit', () => {
    // A ghost that blinked would be indistinguishable from a building already there, and a ghost
    // that lit the valley would let a player survey the map by dragging a lamp around it.
    let live = 0;
    const def = defineSprite({
      id: 'live',
      w: 1,
      d: 1,
      massing: (s) => s.box(0, 0, 1, 1, { color: 'brand', h: 1 }),
      animate: () => void (live += 1),
      emit: () => void (live += 1),
    });
    const { surface, pen } = scene();
    const field = createLightField(surface);
    const framePen = { ...pen, light: field };
    field.begin(framePen, 1, 'night');
    drawGhost(framePen, def, 0, 0, VARIANT_ZERO, true);
    expect(live).toBe(0);
  });

  it('lifts clear of the ground it is testing', () => {
    const { surface, pen } = scene({ snap: false });
    drawSprite(pen, SHED, 0, 0, VARIANT_ZERO);
    const grounded = firstOp(surface, 'stroke').xy[1] as number;
    surface.reset();
    drawGhost(pen, SHED, 0, 0, VARIANT_ZERO, true);
    expect(firstOp(surface, 'stroke').xy[1] as number).toBeLessThan(grounded);
  });

  it('composes its fade with a solid’s own alpha rather than being overwritten by it', () => {
    const translucent = defineSprite({
      id: 'translucent',
      w: 1,
      d: 1,
      massing: (s) => s.box(0, 0, 1, 1, { color: 'brand', h: 1, alpha: 0.5 }),
    });
    const { surface, pen } = scene();
    drawGhost(pen, translucent, 0, 0, VARIANT_ZERO, true);
    const values = opsOf(surface, 'alpha').map((op) => op.value);
    // Ghost fade, then the solid's own alpha *multiplied* into it, then back.
    expect(values[1]).toBeLessThan(values[0] ?? 1);
  });

  it('restores the multiplier even when the massing throws', () => {
    const bad = defineSprite({
      id: 'bad-ghost',
      w: 1,
      d: 1,
      massing: () => {
        throw new Error('nope');
      },
    });
    const { surface, pen } = scene();
    expect(() => drawGhost(pen, bad, 0, 0, VARIANT_ZERO, true)).toThrow('nope');
    expect(opsOf(surface, 'alpha').map((op) => op.value)).toEqual([0.55, 1]);
  });
});

describe('drawFootprint', () => {
  it('is one dashed closed four-point stroke, lifted off the ground', () => {
    const { surface, pen } = scene();
    drawFootprint(pen, 1, 1, 2, 3, 'ok');
    const op = firstOp(surface, 'stroke');
    expect(op.value).toBe(1);
    expect(op.xy).toHaveLength(8);
    expect(op.text).toMatch(/^closed dash /);
  });

  it('marches off the frame clock, so a replay puts the ants in the same place', () => {
    const a = scene({ t: 0 });
    const b = scene({ t: 0.5 });
    const c = scene({ t: 0.5 });
    drawFootprint(a.pen, 0, 0, 1, 1, 'ok');
    drawFootprint(b.pen, 0, 0, 1, 1, 'ok');
    drawFootprint(c.pen, 0, 0, 1, 1, 'ok');
    expect(firstOp(a.surface, 'stroke').text).not.toBe(firstOp(b.surface, 'stroke').text);
    expect(firstOp(b.surface, 'stroke').text).toBe(firstOp(c.surface, 'stroke').text);
  });

  it('takes an explicit height for a rim that sits on something raised', () => {
    const { surface, pen } = scene({ snap: false });
    drawFootprint(pen, 0, 0, 1, 1, 'ok');
    const low = firstOp(surface, 'stroke').xy[1] as number;
    surface.reset();
    drawFootprint(pen, 0, 0, 1, 1, 'ok', 2);
    // Against the default, which is `SELECT_LIFT` rather than the ground: a rim at z = 0
    // z-fights the tile beneath it at some zooms and not others.
    expect(low - (firstOp(surface, 'stroke').xy[1] as number)).toBeCloseTo(
      levelsToPx(2 - SELECT_LIFT),
      3,
    );
  });
});

describe('the measuring replay', () => {
  it('spriteHeightPx is derived from the massing, in world pixels', () => {
    // The tower reaches 3 storeys of box, half a storey of roof and a cylinder above that.
    const height = spriteHeightPx(TOWER, VARIANT_ZERO);
    expect(height).toBeCloseTo(levelsToPx(4.1), 6);
    expect(spriteHeightPx(SHED, VARIANT_ZERO)).toBe(LEVEL_H);
  });

  it('spriteVolume converts storeys to world pixels at the boundary', () => {
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    expect(spriteVolume(SHED, VARIANT_ZERO, volume)).toBe(volume);
    expect(volume).toEqual({ ox: 0, oy: 0, w: 1, d: 1, zPx: 0, hPx: LEVEL_H });
  });

  it('spriteVolume never measures a sprite as smaller than its declared footprint', () => {
    const empty = defineSprite({ id: 'empty', w: 3, d: 2, massing: () => undefined });
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    spriteVolume(empty, VARIANT_ZERO, volume);
    expect(volume.w).toBe(3);
    expect(volume.d).toBe(2);
    expect(volume.hPx).toBe(0);
  });

  it('feeds a silhouette that a tap on the body actually hits', () => {
    // The picking half of the seam, end to end: massing → volume → silhouette → point test. A
    // volume built in storeys would make this pass everywhere except near the roof.
    const { pen, camera } = scene({ snap: false });
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    spriteVolume(SHED, VARIANT_ZERO, volume);
    const outline = boxSilhouette(camera, 0, 0, volume, new Float64Array(12));
    // A point half a storey up the near face of a box standing on the origin.
    const bodyX = camera.toScreenX(0);
    const bodyY = camera.toScreenY(32 - LEVEL_H / 2);
    expect(pointInPolygon(bodyX, bodyY, outline, 6)).toBe(true);
    expect(pointInPolygon(bodyX, bodyY - 400, outline, 6)).toBe(false);
    expect(pen.camera).toBe(camera);
  });

  it('spriteBounds frames the whole massing, including a glow halo', () => {
    const { camera } = scene();
    const box: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    expect(spriteBounds(TOWER, VARIANT_ZERO, camera, 0, 0, box)).toBe(box);
    expect(box.maxX).toBeGreaterThan(box.minX);
    expect(box.maxY).toBeGreaterThan(box.minY);
    // The top of the box is the tallest thing in the massing, so the frame reaches above the
    // ground plane by at least the sprite's own height.
    expect(camera.toScreenY(0) - box.minY).toBeGreaterThan(spriteHeightPx(TOWER, VARIANT_ZERO) - 1);
  });

  it('spriteBounds grows with the sprite and moves with the camera', () => {
    const { camera } = scene();
    const small: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const large: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    spriteBounds(SHED, VARIANT_ZERO, camera, 0, 0, small);
    spriteBounds(TOWER, VARIANT_ZERO, camera, 0, 0, large);
    expect(large.maxX - large.minX).toBeGreaterThan(small.maxX - small.minX);
    const moved: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    spriteBounds(SHED, VARIANT_ZERO, camera, 5, 0, moved);
    expect(moved.minX).toBeGreaterThan(small.minX);
  });

  it('sees the kit’s base palette rather than the frame’s, which is why a massing branches on the variant', () => {
    let seen = 0;
    const def = defineSprite({
      id: 'palette-reader',
      w: 1,
      d: 1,
      massing: (s) => {
        seen = s.palette.get('brand');
      },
    });
    const { pen, palette } = scene();
    palette.set('brand', rgba(1, 1, 1));
    drawSprite(pen, def, 0, 0, VARIANT_ZERO);
    expect(seen).toBe(rgba(1, 1, 1));
    spriteHeightPx(def, VARIANT_ZERO);
    expect(seen).not.toBe(rgba(1, 1, 1));
  });

  it('measures a wall and a sign by their span, both ways round', () => {
    const def = defineSprite({
      id: 'spans',
      w: 1,
      d: 1,
      massing: (s) => {
        s.wall(2, 3, -1, -2, 2, 0, 'glass');
        s.sign(0, 0, 1, 0, 4, 1, 'X', 'ink');
      },
    });
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    spriteVolume(def, VARIANT_ZERO, volume);
    expect(volume.ox).toBe(-1);
    expect(volume.oy).toBe(-2);
    expect(volume.w).toBe(3);
    expect(volume.zPx).toBe(0);
    expect(volume.hPx).toBeCloseTo(levelsToPx(4), 6);
  });

  it('measures a sprite that digs downward as starting below the ground plane', () => {
    // A basement, a pit, a sunken pad. Clamping the base at zero would make `boxSilhouette`
    // return an outline that stops at the ground while the pixels carry on below it.
    const def = defineSprite({
      id: 'basement',
      w: 1,
      d: 1,
      massing: (s) => s.box(0, 0, 1, 1, { color: 'brand', h: 2, z: -1 }),
    });
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    spriteVolume(def, VARIANT_ZERO, volume);
    expect(volume.zPx).toBe(-LEVEL_H);
    expect(volume.hPx).toBe(LEVEL_H * 2);
  });
});

/**
 * The ground under a sprite — this package's half of the elevation contract with `iso`.
 *
 * `iso` produces elevations in world pixels and `draw` draws in storeys, and until `drawSprite`
 * took a `zPx` there was no honest way for the two to meet: every sprite on a heightfield floated
 * or sank by its own terrain height, and the exhibit that found it smuggled the number through
 * `Variant.level` and documented the abuse in its own source.
 *
 * Both packages had full coverage and no shared test, which is exactly how that shipped. So the
 * assertions below are written against `iso`'s own projection — where does `gridToScreen` put a
 * point at this elevation — rather than against the arithmetic in `sprite.ts`, and they hold
 * whatever that arithmetic becomes.
 */
describe('the ground under a sprite', () => {
  /** The same rounding the recording backend applies, so an expectation and an op compare
   *  exactly rather than nearly. */
  function r3(value: number): number {
    const scaled = Math.round(value * 1000) / 1000;
    return scaled === 0 ? 0 : scaled;
  }

  const at: Vec2 = { x: 0, y: 0 };

  /** A footprint with nothing but its contact shadow — the primitive that had no elevation at
   *  all, and the one whose whole job is to say *the object is here*. */
  const PAD: SpriteDef = defineSprite({
    id: 'pad',
    w: 2,
    d: 2,
    massing: (s) => s.shadow(0, 0, 2, 2),
  });

  it('stands the massing on the ground iso reports, at every height', () => {
    // The south-base corner of a one-tile box is the grid point (gx+1, gy+1) at the ground
    // elevation. Where `gridToScreen` puts that point is where the sprite's base has to be, and
    // the stroke's fourth point is where it actually is. Below sea level too: a jetty on a shelf
    // and a pit are the same case with the sign flipped.
    for (const groundPx of [0, 8, 26, 123.5, 481, -40]) {
      const { surface, pen, camera } = scene();
      drawSprite(pen, SHED, 2, 3, VARIANT_ZERO, groundPx);
      const xy = firstOp(surface, 'stroke').xy;
      gridToScreen(camera, 3, 4, groundPx, at);
      expect(xy[6], `x at ground ${String(groundPx)}`).toBe(r3(at.x));
      expect(xy[7], `y at ground ${String(groundPx)}`).toBe(r3(at.y));
    }
  });

  it('is a whole-sprite offset: the shape is unchanged, only its place', () => {
    // Every point moves by exactly `-zPx · zoom` in screen y and by nothing in x, because
    // elevation is a screen-y shift in this projection and not a third axis.
    const flat = scene({ zoom: 2 });
    drawSprite(flat.pen, TOWER, 1, 1, VARIANT_ZERO);
    const raised = scene({ zoom: 2 });
    drawSprite(raised.pen, TOWER, 1, 1, VARIANT_ZERO, 100);
    expect(raised.surface.ops).toHaveLength(flat.surface.ops.length);
    let compared = 0;
    flat.surface.ops.forEach((op, i) => {
      const lifted = raised.surface.ops[i];
      expect(lifted?.op).toBe(op.op);
      expect(lifted?.colors).toEqual(op.colors);
      // `poly` and `stroke` alone, because they are the two ops whose `xy` is nothing but a
      // vertex list: an ellipse's third and fourth slots are radii, and a radius that moved
      // with the ground would be a different bug entirely.
      if (op.op !== 'poly' && op.op !== 'stroke') return;
      for (let k = 0; k < op.xy.length; k += 2) {
        expect(lifted?.xy[k]).toBe(op.xy[k]);
        // Rounded, because both sides are already three-decimal values and their difference in
        // binary is 199.99999999999997 as often as it is 200.
        expect(r3((lifted?.xy[k + 1] ?? 0) - (op.xy[k + 1] ?? 0))).toBe(-100 * 2);
        compared += 1;
      }
    });
    expect(compared).toBeGreaterThan(20);
  });

  it('crosses into storeys once, so a whole number of them is exactly a lifted massing', () => {
    // `LEVEL_H` world pixels of ground and one extra storey on every solid are the same picture,
    // op for op — which is the statement that the ground enters the massing as an offset and not
    // as a second coordinate system.
    const HUT_UP: SpriteDef = defineSprite({
      id: 'hut-up',
      w: 1,
      d: 1,
      massing: (s) => s.box(0, 0, 1, 1, { color: 'brand', h: 1, z: 2 }),
    });
    const ground = scene();
    drawSprite(ground.pen, SHED, 5, 2, VARIANT_ZERO, levelsToPx(2));
    const storeys = scene();
    drawSprite(storeys.pen, HUT_UP, 5, 2, VARIANT_ZERO);
    expect(ground.surface.ops).toEqual(storeys.surface.ops);
  });

  it('lands the contact shadow on the hill rather than in the valley', () => {
    // The gap that detached every shadow in the kit from the building above it: `contactShadow`
    // had no elevation, so a building climbed the hill and its shadow stayed at sea level.
    const { surface, pen, camera } = scene();
    drawSprite(pen, PAD, 4, 4, VARIANT_ZERO, 96);
    const op = firstOp(surface, 'softEllipse');
    gridToScreen(camera, 5, 5, 96, at);
    expect(op.xy[0]).toBe(r3(at.x));
    expect(op.xy[1]).toBe(r3(at.y));
  });

  it('lets a massing raise a shadow above its own ground, and defaults to the ground', () => {
    // A shadow under a terrace the sprite itself built. Default 0 is the ground, wherever
    // `drawSprite` was told that is, so no massing names its elevation to be grounded.
    const TERRACE: SpriteDef = defineSprite({
      id: 'terrace',
      w: 1,
      d: 1,
      massing: (s) => s.shadow(0, 0, 1, 1, 1, 3),
    });
    const { surface, pen, camera } = scene();
    drawSprite(pen, TERRACE, 0, 0, VARIANT_ZERO, 50);
    gridToScreen(camera, 0.5, 0.5, 50 + levelsToPx(3), at);
    expect(firstOp(surface, 'softEllipse').xy[1]).toBe(r3(at.y));
  });

  it('hands animate and emit the pixels iso produced, unconverted', () => {
    // `animate` draws through the free primitives, which nothing can stand on the ground for it,
    // and `emit` feeds `LightField.add`, whose third argument is already world pixels. Both get
    // the number `drawSprite` was given, and it is the last parameter of each so that inserting
    // it could not silently rebind `v` in every animator ever written.
    const seen: number[] = [];
    const WATCH: SpriteDef = defineSprite({
      id: 'watch',
      w: 1,
      d: 1,
      massing: () => undefined,
      animate: (_pen, _gx, _gy, _v, _rng, zPx) => seen.push(zPx),
      emit: (field, gx, gy, _v, _rng, zPx) => {
        seen.push(zPx);
        field.add(gx, gy, zPx, 2, 1, 'warn');
      },
    });
    const { surface, pen } = scene();
    const light = createLightField(surface);
    const framePen = { ...pen, light };
    light.begin(framePen, 0.5, 'night');
    drawSprite(framePen, WATCH, 0, 0, VARIANT_ZERO, 137.5);
    expect(seen).toEqual([137.5, 137.5]);
  });

  it('leaves a flat game paying nothing: the default is sea level', () => {
    const flat = scene();
    drawSprite(flat.pen, TOWER, 2, 2, VARIANT_ZERO);
    const explicit = scene();
    drawSprite(explicit.pen, TOWER, 2, 2, VARIANT_ZERO, 0);
    expect(flat.surface.ops).toEqual(explicit.surface.ops);
  });

  it('grounds a placement ghost too, above the tile it is testing rather than above the sea', () => {
    // A ghost that ignored the ground would let a player judge the fit of a building against
    // ground it will not stand on.
    const sea = scene();
    drawGhost(sea.pen, SHED, 0, 0, VARIANT_ZERO, true);
    const hill = scene();
    drawGhost(hill.pen, SHED, 0, 0, VARIANT_ZERO, true, 60);
    const low = firstOp(sea.surface, 'stroke').xy[1] as number;
    const high = firstOp(hill.surface, 'stroke').xy[1] as number;
    // Up the screen by the ground, and the ghost's own clearance above it is untouched.
    expect(r3(low - high)).toBe(60);
  });

  it('grounds a selection rim, keeping the z-fight ladder separate from the terrain', () => {
    // Two facts in two units: `SELECT_LIFT` is this package's anti-flicker constant and the
    // ground is `iso`'s terrain. Adding them at the call site is how the constant ends up
    // multiplied by a height.
    const { surface, pen, camera } = scene();
    drawFootprint(pen, 0, 0, 1, 1, 'ok', SELECT_LIFT, 78);
    gridToScreen(camera, 0, 0, 78 + levelsToPx(SELECT_LIFT), at);
    expect(firstOp(surface, 'stroke').xy[1]).toBe(r3(at.y));
  });

  it('adds the ground to a volume in pixels, exactly, because picking compares numbers', () => {
    // The one path that must not go through storeys and back: `boxSilhouette` is handed this
    // number, and a `Volume` whose base is a storey count multiplied out is an outline that is
    // *nearly* right. 123.5 is deliberately not a multiple of `LEVEL_H`.
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    spriteVolume(SHED, VARIANT_ZERO, volume, 123.5);
    expect(volume.zPx).toBe(123.5);
    expect(volume.hPx).toBe(LEVEL_H);
    const basement = defineSprite({
      id: 'sunk',
      w: 1,
      d: 1,
      massing: (s) => s.box(0, 0, 1, 1, { color: 'brand', h: 2, z: -1 }),
    });
    spriteVolume(basement, VARIANT_ZERO, volume, 100);
    expect(volume.zPx).toBe(100 - LEVEL_H);
  });

  it('so a tap on a building up a hill hits the building and not the air above it', () => {
    // End to end, and the failure it closes: the picture is right, the taps land in mid-air, and
    // both packages' suites stay green because neither can see the other's half.
    const { pen, camera } = scene();
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    const sil = new Float64Array(12);
    const groundPx = 130;
    drawSprite(pen, SHED, 3, 3, VARIANT_ZERO, groundPx);
    spriteVolume(SHED, VARIANT_ZERO, volume, groundPx);
    boxSilhouette(camera, 3, 3, volume, sil);
    // The middle of the box: half a storey up from the ground, at the center of the footprint.
    gridToScreen(camera, 3.5, 3.5, groundPx + LEVEL_H / 2, at);
    expect(pointInPolygon(at.x, at.y, sil, 6)).toBe(true);
    // And the volume computed at sea level does not contain it, which is the bug.
    spriteVolume(SHED, VARIANT_ZERO, volume);
    boxSilhouette(camera, 3, 3, volume, sil);
    expect(pointInPolygon(at.x, at.y, sil, 6)).toBe(false);
  });

  it('shifts screen bounds by the ground and leaves the measured height alone', () => {
    // `spriteBounds` is a position and moves; `spriteHeightPx` is a height and does not. The
    // caller adds the ground to the second itself, which is the same sum in the same unit.
    const flat: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const raised: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const { pen, camera } = scene({ zoom: 2 });
    spriteBounds(TOWER, VARIANT_ZERO, camera, 0, 0, flat);
    spriteBounds(TOWER, VARIANT_ZERO, camera, 0, 0, raised, 50);
    void pen;
    expect(raised.minX).toBe(flat.minX);
    expect(raised.maxX).toBe(flat.maxX);
    expect(flat.minY - raised.minY).toBe(50 * 2);
    expect(flat.maxY - raised.maxY).toBe(50 * 2);
    expect(spriteHeightPx(TOWER, VARIANT_ZERO)).toBe(spriteHeightPx(TOWER, VARIANT_ZERO));
  });

  it('refuses a ground that would make a sprite silently absent', () => {
    // A NaN elevation propagates into every coordinate and paints nothing, on one tile, on one
    // seed — reported as "the save did not load", with no other symptom. It arrives from a
    // heightfield sampled at a position the game computed, which is exactly the chain that
    // produces one.
    const { pen, camera } = scene();
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    const rect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    expect(() => drawSprite(pen, SHED, 0, 0, VARIANT_ZERO, Number.NaN)).toThrow(
      /drawSprite: expected a finite ground elevation in world pixels, got NaN/,
    );
    expect(() => drawGhost(pen, SHED, 0, 0, VARIANT_ZERO, true, Infinity)).toThrow(RangeError);
    expect(() => drawFootprint(pen, 0, 0, 1, 1, 'ok', 0, Number.NaN)).toThrow(RangeError);
    expect(() => spriteVolume(SHED, VARIANT_ZERO, volume, Number.NaN)).toThrow(RangeError);
    expect(() => spriteBounds(SHED, VARIANT_ZERO, camera, 0, 0, rect, -Infinity)).toThrow(
      RangeError,
    );
  });
});
