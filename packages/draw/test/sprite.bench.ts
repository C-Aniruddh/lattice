/**
 * **The benchmark that decides whether this package needs a sprite cache.**
 *
 * The RFC wrote `cache` as provisional and said deleting it was a clean outcome. The number that
 * settles it is not a hit rate — it is the frame time of the *direct* path at the demo's real
 * sprite count. If direct drawing fits the 8 ms budget with headroom, a cache is a liability: it
 * adds zoom buckets, palette revisions, blit snapping and a don't-fill-while-moving rule, and
 * every one of those is a way to render something stale.
 *
 * So the frames below are the whole experiment: a realistic building of about thirty primitives,
 * drawn 200, 400 and 1,000 times, through a camera at a phone's device pixel ratio, into a
 * backend that does the geometry and no rasterisation (see `null-surface.ts` for exactly what
 * that includes and excludes).
 *
 * The per-primitive rows underneath exist so that a regression can be attributed rather than
 * merely noticed.
 */

import { hashStep, hashString } from '@lattice/core';
import { TileGrid, createCamera } from '@lattice/iso';
import type { HeightField } from '@lattice/iso';
import { bench, describe } from 'vitest';
import { isoTerrain } from '../src/terrain.js';
import { BASE_SLOTS, DAY, NIGHT, createPalette } from '../src/palette.js';
import { beginFrame } from '../src/surface.js';
import type { Bitmap, Pen } from '../src/surface.js';
import { createLightField } from '../src/light.js';
import { contactShadow } from '../src/shadow.js';
import { glowDot, isoBox, isoCylinder, isoPost, isoRoof, isoTile } from '../src/solids.js';
import { VARIANT_ZERO, defineSprite, drawSprite, spriteHeightPx } from '../src/sprite.js';
import type { SpriteDef, Variant } from '../src/sprite.js';
import { wallText } from '../src/text.js';
import { createNullSurface } from './null-surface.js';

/**
 * A building of about thirty primitives — the "few dozen polygons each" the cache question was
 * posed about.
 *
 * Written the way a game would write one: a plinth, a body, setbacks that branch on the upgrade
 * level, windows down two faces, a roof, a tank, a mast and a row of lit windows.
 */
const BUILDING: SpriteDef = defineSprite({
  id: 'bench-tower',
  w: 3,
  d: 3,
  massing(s, v, rng) {
    s.shadow(0, 0, 3, 3);
    s.patch(0, 0, 3, 3, 0.002, 'metal');
    s.box(0, 0, 3, 3, { color: 'brand', h: 4 });
    s.box(0, 0, 3, 3, { color: 'brand', h: 2, z: 4, inset: 0.35, outline: false });
    if (v.level > 1) s.box(0.6, 0.6, 1.8, 1.8, { color: 'metal', h: 1.5, z: 6, outline: false });
    for (let i = 0; i < 5; i++) {
      s.wall(0.2 + i * 0.55, 0, 0.7 + i * 0.55, 0, 1 + (i % 2), 2 + (i % 2), 'glass');
      s.wall(3, 0.2 + i * 0.55, 3, 0.7 + i * 0.55, 1, 2, 'glass');
    }
    s.roof(0.35, 0.35, 2.3, 2.3, 6, 0.7, 'metal');
    s.cylinder(1.5, 1.5, 0.55, { color: 'metal', h: 1, z: 6.7 });
    s.post(1.5, 1.5, 7.7, 2.4, 'metal');
    for (let i = 0; i < 6; i++) {
      s.glow(0.3 + (i % 3) * 1.1, 0.3 + Math.floor(i / 3) * 1.4, 4.05, 'warn', 0.09, rng.next());
    }
    if (v.label !== '') s.sign(0.2, 0, 2.8, 0, 4, 0.7, v.label, 'ink');
  },
  animate(pen, gx, gy, v, rng) {
    const blink = ((pen.t * 1.4 + rng.next()) % 1 < 0.5 ? 1 : 0.25) * (v.level > 1 ? 1 : 0.6);
    glowDot(pen, gx + 1.5, gy + 1.5, 10.1, 'warn', 0.14, blink);
  },
});

/** One instance's placement and variant, laid out once and reused for every frame. */
interface Instance {
  readonly gx: number;
  readonly gy: number;
  readonly v: Variant;
}

/** A square-ish campus of `n` buildings, four tiles apart, with varied levels and seeds. */
function campus(n: number): Instance[] {
  const side = Math.ceil(Math.sqrt(n));
  const out: Instance[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      gx: (i % side) * 4,
      gy: Math.floor(i / side) * 4,
      v: { level: 1 + (i % 3), seed: i * 2654435761, flags: 1, progress: 1, label: '' },
    });
  }
  return out;
}

/**
 * Everything a frame needs, built once.
 *
 * The camera is pulled back far enough that every building is on screen, so the numbers below
 * are the *worst* case rather than the culled one — `iso` culls before `draw` ever sees an item,
 * and benchmarking the culled case would be benchmarking `iso`.
 */
function stage(n: number, pixelRatio: number): { pen: Pen; items: Instance[] } {
  const items = campus(n);
  const side = Math.ceil(Math.sqrt(n)) * 4;
  const surface = createNullSurface(1600, 1000, pixelRatio);
  const camera = createCamera(1600, 1000, {
    zoom: Math.min(1, 40 / side),
    minZoom: 0.01,
    bounds: { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 },
  });
  camera.centerOnTile(side / 2, side / 2);
  const palette = createPalette(BASE_SLOTS);
  const pen = beginFrame({ surface, camera, palette, t: 1.25, clear: 'sky' });
  return { pen, items };
}

/** Ops submitted for one building, as the benchmark's own denominator. */
function opsPerBuilding(): number {
  const { pen, items } = stage(1, 3);
  const surface = pen.surface as ReturnType<typeof createNullSurface>;
  surface.reset();
  const first = items[0];
  if (first !== undefined) drawSprite(pen, BUILDING, first.gx, first.gy, first.v);
  return surface.count;
}

describe('a frame of buildings, drawn direct', () => {
  // Printed once so the tables in docs/PERFORMANCE.md can quote it rather than assert it.
  const perBuilding = opsPerBuilding();
  const phone = 3;

  const s200 = stage(200, phone);
  bench(`200 sprites × ${String(perBuilding)} ops, dpr ${String(phone)}`, () => {
    for (const item of s200.items) drawSprite(s200.pen, BUILDING, item.gx, item.gy, item.v);
  });

  const s400 = stage(400, phone);
  bench(`400 sprites × ${String(perBuilding)} ops, dpr ${String(phone)}`, () => {
    for (const item of s400.items) drawSprite(s400.pen, BUILDING, item.gx, item.gy, item.v);
  });

  const s1000 = stage(1000, phone);
  bench(`1000 sprites × ${String(perBuilding)} ops, dpr ${String(phone)}`, () => {
    for (const item of s1000.items) drawSprite(s1000.pen, BUILDING, item.gx, item.gy, item.v);
  });

  const s400flat = stage(400, 1);
  bench('400 sprites, dpr 1 — the ratio is not in the geometry', () => {
    for (const item of s400flat.items) drawSprite(s400flat.pen, BUILDING, item.gx, item.gy, item.v);
  });
});

/**
 * **The other half of the cache question: the best a cache could possibly do.**
 *
 * A cache does not make a frame free. On a hit it still has to build the key — sprite id, level,
 * seed, flags, quantised progress, label, palette revision, zoom bucket — look it up, and submit
 * a blit. This measures exactly that and nothing else: a perfect cache, 100% hit rate, no misses
 * and no eviction. Whatever the direct frame costs, a cache can save at most the difference
 * between it and this row, and it buys that saving with four new ways to render something stale.
 */
describe('the floor a perfect cache could reach', () => {
  const { pen, items } = stage(400, 3);
  const cached = new Map<number, Bitmap>();
  const image = pen.surface.createTarget(96, 160).bitmap;
  const idHash = hashString(BUILDING.id);

  bench('400 warm cache hits: key, lookup, blit', () => {
    const rev = pen.palette.rev;
    const bucket = Math.round(Math.log2(pen.camera.zoom) * 4);
    for (const item of items) {
      let key = hashStep(idHash, item.v.level);
      key = hashStep(key, item.v.seed);
      key = hashStep(key, item.v.flags);
      key = hashStep(key, Math.floor(item.v.progress * 16));
      key = hashStep(key, rev);
      key = hashStep(key, bucket);
      let hit = cached.get(key);
      if (hit === undefined) {
        hit = image;
        cached.set(key, hit);
      }
      pen.surface.blit(hit, item.gx * 32, item.gy * 16, 96, 160);
    }
  });
});

describe('a frame of buildings at night', () => {
  const s400 = stage(400, 3);
  const field = createLightField(s400.pen.surface);
  const lit: Pen = { ...s400.pen, light: field };
  const LAMP: SpriteDef = defineSprite({
    id: 'bench-lamp',
    w: 1,
    d: 1,
    massing: (s) => s.post(0.5, 0.5, 0, 2, 'metal'),
    emit: (f, gx, gy) => f.add(gx + 0.5, gy + 0.5, 0, 3.5, 0.9, 'warn'),
  });

  bench('400 buildings + 120 lamps, mask composited once', () => {
    field.begin(lit, 0.75, 'night');
    for (const item of s400.items) drawSprite(lit, BUILDING, item.gx, item.gy, item.v);
    for (let i = 0; i < 120; i++) drawSprite(lit, LAMP, (i % 20) * 4 + 2, Math.floor(i / 20) * 8, VARIANT_ZERO);
    field.composite();
  });
});

describe('terrain', () => {
  const { pen } = stage(1, 3);
  // A real heightfield rather than an arithmetic one: the Terrain pass reads four vertices per
  // tile through a `TileSource`, and a closure over a multiply would flatter the number by
  // measuring everything except the lookup a game actually pays for.
  const heights = new TileGrid(61, 61, { bits: 8 });
  heights.fillFrom((gx, gy) => (gx * 7 + gy * 13) % 9);
  const field: HeightField = { heights, stepPx: 8 };

  bench('2,400 tile diamonds', () => {
    for (let i = 0; i < 2400; i++) isoTile(pen, i % 60, Math.floor(i / 60), 'ground');
  });

  // The same 2,400 tiles with four corner heights each, so the price of relief is a subtraction
  // against the row above rather than a number on its own. A heightfield game pays it on every
  // visible tile of every frame, which makes this the widest loop in the package.
  bench('2,400 heightfield quads', () => {
    for (let i = 0; i < 2400; i++) isoTerrain(pen, field, i % 60, Math.floor(i / 60), 'ground');
  });
});

describe('one primitive at a time', () => {
  const { pen } = stage(1, 3);
  const opts = { color: 'brand', h: 3 } as const;

  bench('isoBox', () => {
    for (let i = 0; i < 1000; i++) isoBox(pen, i & 31, (i >> 5) & 31, 2, 2, opts);
  });

  bench('isoTile', () => {
    for (let i = 0; i < 1000; i++) isoTile(pen, i & 31, (i >> 5) & 31, 'ground');
  });

  bench('isoRoof', () => {
    for (let i = 0; i < 1000; i++) isoRoof(pen, i & 31, (i >> 5) & 31, 2, 2, 3, 0.6, 'metal');
  });

  bench('isoCylinder', () => {
    for (let i = 0; i < 1000; i++) isoCylinder(pen, i & 31, (i >> 5) & 31, 0.6, opts);
  });

  bench('isoPost', () => {
    for (let i = 0; i < 1000; i++) isoPost(pen, i & 31, (i >> 5) & 31, 0, 2, 'metal');
  });

  bench('glowDot', () => {
    for (let i = 0; i < 1000; i++) glowDot(pen, i & 31, (i >> 5) & 31, 3, 'warn');
  });

  bench('contactShadow', () => {
    for (let i = 0; i < 1000; i++) contactShadow(pen, i & 31, (i >> 5) & 31, 2, 2);
  });

  bench('wallText', () => {
    for (let i = 0; i < 1000; i++) wallText(pen, 0, 0, 3, 0, 4, 1, 'LATTICE', 'ink');
  });
});

describe('measuring and the palette', () => {
  const { pen } = stage(1, 3);
  const palette = pen.palette;

  bench('spriteHeightPx — the measuring replay', () => {
    for (let i = 0; i < 400; i++) spriteHeightPx(BUILDING, VARIANT_ZERO);
  });

  bench('palette.lerp across a dusk, 360 calls', () => {
    for (let i = 0; i <= 360; i++) palette.lerp(DAY, NIGHT, i / 360);
  });
});
