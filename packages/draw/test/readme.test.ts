/**
 * The README's example, run.
 *
 * `README.md` opens with this program and prints these numbers, and the two are kept honest by
 * this file rather than by anyone remembering. A README example that has drifted is worse than
 * none: it is the first thing a new caller copies, and the failure it produces is in *their*
 * code, where they will look for it.
 *
 * It runs in Node with no canvas anywhere, which is the point of the recording backend and is
 * the reason this example can be a test at all.
 */

import { DepthSorter, boxSilhouette, createCamera, pickSorted, pointInPolygon } from '@lattice/iso';
import type { Rect, TileRange, Volume } from '@lattice/iso';
import { describe, expect, it } from 'vitest';
import {
  BASE_SLOTS,
  DAY,
  NIGHT,
  VARIANT_ZERO,
  beginFrame,
  createLightField,
  createPalette,
  createRecordingSurface,
  defineSprite,
  drawSprite,
  endFrame,
  hexOf,
  hsl,
  glowDot,
  isoTile,
  renderFrame,
  spriteBounds,
  spriteHeightPx,
  spriteVolume,
} from '../src/index.js';
import type { Pen } from '../src/index.js';

describe('the README example', () => {
  it('prints what the README says it prints', () => {
    const out: string[] = [];

    // ── the art: a sprite a game owns, without forking the kit ─────────────────
    const WATER_TOWER = defineSprite({
      id: 'water-tower',
      w: 2,
      d: 2,
      massing(s, v, rng) {
        s.shadow(0, 0, 2, 2);
        for (let i = 0; i < 4; i++) s.post(0.3 + (i % 2) * 1.4, 0.3 + (i > 1 ? 1.4 : 0), 0, 3, 'metal');
        s.cylinder(1, 1, 0.8, { color: 'brand', h: 1.4, z: 3 });
        if (v.level > 2) s.post(1, 1, 4.4, 1, 'metal');
        if (rng.next() > 0.5) s.glow(1, 1, 4.4, 'warn', 0.12);
      },
      // Live art, over the static art, every frame. `pen.t` is the only clock here, and it
      // arrived as a parameter — nothing in this package reads one.
      animate(pen, gx, gy, v, rng) {
        const lit = (pen.t * 1.4 + rng.next()) % 1 < 0.5 ? 1 : 0.2;
        glowDot(pen, gx + 1, gy + 1, 4.6, 'warn', 0.14, lit * (v.level > 2 ? 1 : 0.6));
      },
      // The light it throws. Runs only when the frame has a night.
      emit(field, gx, gy) {
        field.add(gx + 1, gy + 1, 0, 4, 0.9, 'warn');
      },
    });

    // ── the palette, recoloured to a player's brand hue ────────────────────────
    const palette = createPalette(BASE_SLOTS);
    palette.set('brand', hsl(28, 0.62, 0.54)); //   one number in the save, not a token
    out.push(`brand: ${hexOf(palette.get('brand'))}, palette rev ${String(palette.rev)}`);

    // ── the frame ──────────────────────────────────────────────────────────────
    const surface = createRecordingSurface(480, 300); //   no canvas: this runs in Node
    const camera = createCamera(480, 300, {
      bounds: { minX: -400, minY: -200, maxX: 400, maxY: 600 },
    });
    camera.centerOnTile(3, 3);
    const light = createLightField(surface);

    // Deliberately not in depth order: the sorter decides that, and it is the only thing that
    // does. The array is the caller's; `DepthSorter` hands back a permutation of its indices.
    const buildings = [
      { gx: 1, gy: 5, v: { ...VARIANT_ZERO, seed: 3 } },
      { gx: 0, gy: 0, v: { ...VARIANT_ZERO, seed: 1 } },
      { gx: 4, gy: 1, v: { ...VARIANT_ZERO, seed: 2, level: 3 } },
    ] as const;

    const order = new DepthSorter(64); //          allocated once, reused for ever
    const pen = beginFrame({ surface, camera, palette, t: 2.5, clear: 'sky', light });
    light.begin(pen, 0.7, 'night'); //             darkness 0–1, and the color it goes

    order.clear();
    for (const b of buildings) {
      order.add(b.gx, b.gy, 2, 2, spriteHeightPx(WATER_TOWER, b.v));
    }

    renderFrame(
      pen,
      {
        terrain(p: Pen, visible: Readonly<TileRange>) {
          for (let gy = visible.gy0; gy < visible.gy1; gy++) {
            for (let gx = visible.gx0; gx < visible.gx1; gx++) isoTile(p, gx, gy, 'ground');
          }
        },
        // Walk it forwards. Never sort it, never partition it — `pickSorted` walks this same
        // instance backwards, and the two are the same permutation or the tap is a lie.
        solids(p: Pen, sorted: DepthSorter) {
          for (let i = 0; i < sorted.count; i++) {
            const b = buildings[sorted.indexAt(i)];
            if (b !== undefined) drawSprite(p, WATER_TOWER, b.gx, b.gy, b.v);
          }
        },
      },
      order,
    );
    endFrame(pen);

    out.push(`${String(surface.ops.length)} draw calls, digest ${surface.digest()}`);
    out.push(`${String(light.count)} light pools, composited once`);

    const painted: number[] = [];
    for (let i = 0; i < order.count; i++) painted.push(order.indexAt(i));
    out.push(`paint order: ${painted.join(', ')}`);

    // ── the tap, which is the exact reverse of the paint ───────────────────────
    const volume: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
    const outline = new Float64Array(12);
    const tapX = 112;
    const tapY = 125;
    function hitsSilhouette(index: number): boolean {
      const b = buildings[index];
      if (b === undefined) return false;
      spriteVolume(WATER_TOWER, b.v, volume);
      boxSilhouette(camera, b.gx, b.gy, volume, outline);
      return pointInPolygon(tapX, tapY, outline, 6);
    }
    out.push(`tap at (112, 125) hit building ${String(pickSorted(order, hitsSilhouette))}`);

    // ── nightfall: one number recolours the world ──────────────────────────────
    const before = palette.rev;
    for (let i = 0; i <= 360; i++) palette.lerp(DAY, NIGHT, i / 360);
    out.push(`a 6-second dusk bumped rev ${String(palette.rev - before)} times`);
    out.push(`sky at midnight: ${hexOf(palette.get('sky'))}`);

    // ── the same sprite, framed for a shop card ────────────────────────────────
    const card: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    spriteBounds(WATER_TOWER, buildings[2].v, camera, 0, 0, card);
    out.push(
      `level 3 is ${String(spriteHeightPx(WATER_TOWER, buildings[2].v))} world px tall, ` +
        `and frames into ${String(Math.round(card.maxX - card.minX))}×${String(Math.round(card.maxY - card.minY))} css px`,
    );

    expect(out).toEqual([
      'brand: #d28541, palette rev 2',
      '367 draw calls, digest c70db030',
      '3 light pools, composited once',
      'paint order: 1, 2, 0',
      'tap at (112, 125) hit building 0',
      'a 6-second dusk bumped rev 32 times',
      'sky at midnight: #1a2244',
      'level 3 is 140.4 world px tall, and frames into 128×204 css px',
    ]);
  });
});
