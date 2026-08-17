/**
 * @art
 *
 * Where everything that is not a person stands — **and it stands there because of its index, not
 * because anything wrote it down.**
 *
 * There is no array of props in this exhibit. `propAt` is `walkerAt` for furniture: hand it an
 * integer and it fills a scratch point and returns the sprite that belongs there, recomputing from
 * arithmetic on every frame that asks. The frame bucket therefore holds nothing but `number` —
 * a walker is `i`, a prop is `−1 − i` — and the whole scene, people and stone alike, is one
 * function of one integer. Two hundred and eleven objects, and the only thing that survives a
 * frame is the count.
 *
 * That is why this module is art rather than logic. Delete it and the piazza still generates, the
 * eight routes still exist, and every walker is in exactly the place it would have been; the square
 * is simply empty. It holds no state that outlives a frame — the one `Variant` below is a scratch
 * that is overwritten before every use, for the same reason `iso` takes an out-parameter.
 *
 * ## Even spacing on a 3.2:1 ellipse is not even spacing in its parameter
 *
 * `ds/da` on an ellipse is `√(A²sin²a + B²cos²a)`, so points laid at uniform `a` bunch at the ends
 * of the **minor** axis and thin out along the major one. On the squashed island that is the worst
 * possible answer: the colonnade would be a solid wall two viewports off the left and right edges
 * and four lonely columns across the part anyone can see. {@link span} lays props at uniform screen
 * **x** instead and solves the ring for the matching `q`, which is why a colonnade drawn across the
 * waterfront has an even rhythm all the way to both edges of the frame.
 *
 * ## The three bands, and the gaps the routes leave
 *
 * Nothing here stands where a walker goes. `plaza.ts` puts its rings at ρ ≈ 11, 13, 21, 23, 33, 35
 * and swings two lozenges through ρ 23.6–30.4, which leaves four clear annuli — and each one is a
 * distance band `docs/GALLERY.md` § Scale asks for:
 *
 * | ρ | what stands there | the band |
 * |---|---|---|
 * | 0 – 9 | the fountain, and a ring of market stalls around its apron | mid, and the composition's anchor |
 * | 15.4 – 19 | the garden: lamps, planes, urns, benches — and two pavilions on the near arc | near, large, cut by the bottom edge |
 * | 38.6 | the waterfront colonnade, running off both edges of the frame | far, small, hazed by the light field |
 */
import { hash2, toUnit } from '@latticekit/core';
import { heightAt, type GridPoint, type HeightField } from '@latticekit/iso';
import { drawSprite, type Pen, type SpriteDef } from '@latticekit/draw';
import type { Bucket } from '../../_shared/src/index.js';
import { PC, SQUASH } from './plaza.js';
import { bench, fountain, lamp, pavilion, pillar, stall, tree, urn } from './scenery.js';

/** Columns along the waterfront, things in the garden ring, and stalls around the fountain. */
const RIM = 72, GARDEN = 60, STALLS = 10;

/** How many objects the piazza has. There is no list — this is the domain of {@link propAt}. */
export const PROPS = 1 + RIM + 2 + GARDEN + STALLS;

/** Silhouette height in world pixels per sprite, for the depth key and the terrain cull margin.
 *  A constant table rather than `spriteHeightPx`, which replays a whole massing to answer. */
const TOPS = new Map<SpriteDef, number>([
  [fountain, 68], [pillar, 92], [pavilion, 120], [lamp, 84], [stall, 54], [tree, 64], [urn, 24], [bench, 14],
]);

/** Overwritten before every use. A `Variant`'s fields are `readonly` to its *consumer*; nothing in
 *  `draw` retains one, so a scratch is the out-parameter this signature never grew. */
const V = { level: 1, seed: 0, flags: 0, progress: 1, label: '' };

/**
 * The `k`-th of `n` positions laid at even screen x along ring `rho`, on the far arc (`side` −1)
 * or the near one (`side` +1).
 *
 * `0.985` keeps the extreme pair off the exact end of the major axis, where the solved `q` is zero
 * and two neighbours would land on the same tile.
 */
function span(rho: number, k: number, n: number, side: number, out: GridPoint): void {
  const p = (rho / SQUASH) * (((k + 0.5) / n) * 2 - 1) * 0.985;
  const flat = SQUASH * p;
  const q = side * Math.sqrt(Math.max(0, rho * rho - flat * flat));
  out.gx = PC + (q + p) * 0.5;
  out.gy = PC + (q - p) * 0.5;
}

/**
 * What stands at index `i`, and where — into `out`. Pure arithmetic on `i`, every time.
 *
 * `out` is the sprite's **origin**, so a 3×3 pavilion is offset by its own half-width here rather
 * than at the two call sites, which is the kind of asymmetry that puts a shadow a metre from the
 * thing casting it.
 */
export function propAt(i: number, out: GridPoint): SpriteDef {
  if (i === 0) {
    out.gx = PC - 1.5;
    out.gy = PC - 1.5;
    return fountain;
  }
  let j = i - 1;
  if (j < RIM) {
    span(38.6, j, RIM, -1, out);
    return pillar;
  }
  j -= RIM;
  if (j < 2) {
    // Two on the near arc of the garden, framing the bottom corners: the near band, deliberately
    // large and deliberately cut by the frame edge.
    span(17.4, j === 0 ? 1 : 6, 8, 1, out);
    out.gx -= 1.5;
    out.gy -= 1.5;
    return pavilion;
  }
  j -= 2;
  if (j < GARDEN) {
    const half = GARDEN >> 1;
    const side = j < half ? -1 : 1;
    const k = j < half ? j : j - half;
    span(15.4 + toUnit(hash2(0x6a1, j, 1)) * 3.6, k, half, side, out);
    const pick = hash2(0x6a1, j, 2) & 7;
    return pick < 2 ? lamp : pick < 5 ? tree : pick === 5 ? bench : urn;
  }
  j -= GARDEN;
  const half = STALLS >> 1;
  span(8.4, j < half ? j : j - half, half, j < half ? -1 : 1, out);
  out.gx -= 1;
  out.gy -= 1;
  return stall;
}

/** The per-instance identity, from the index alone — so column 19 leans the way column 19 leans on
 *  every reload, at every walker count, and after every re-sort. */
function dress(i: number): typeof V {
  V.seed = hash2(0x6a1, i, 3);
  // Bit 0 dresses every third column with a pennant and bit 1 chooses its hue; a stall reads the
  // same bit for its awning. One flag word, two readers, no branch here.
  V.flags = i % 3 === 0 ? 1 | (hash2(0x6a1, i, 4) & 2) : hash2(0x6a1, i, 4) & 2;
  return V;
}

/** Put the piazza's furniture into the frame's sort. One scratch point, no allocation. */
export function addProps(bucket: Bucket<number>, field: HeightField, at: GridPoint): void {
  for (let i = 0; i < PROPS; i++) {
    const def = propAt(i, at);
    const base = heightAt(field, at.gx, at.gy);
    bucket.add(-1 - i, at.gx, at.gy, def.w, def.d, base + (TOPS.get(def) ?? 64));
  }
}

/** Paint prop `i`. Called from the solids pass in sorted order, and it recomputes the position the
 *  sort already computed — for the same reason `walkerAt` does. Nothing was written down. */
export function drawProp(pen: Pen, i: number, field: HeightField, at: GridPoint): void {
  const def = propAt(i, at);
  drawSprite(pen, def, at.gx, at.gy, dress(i), heightAt(field, at.gx, at.gy));
}
