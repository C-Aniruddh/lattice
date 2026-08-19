import { fbm2, hash2, hashString, toUnit } from '@latticekit/core';
import { Path, TileGrid, type HeightField, type Rect } from '@latticekit/iso';

export const W = 160;
export const H = 160;
export const STEP_PX = 8;
export const SEED = hashString('morning-oven');

export const GRASS = 0;
export const PAVE = 1;
export const ROAD = 2;

export const FREE = 0;
export const WALL = 1;
export const CLOSED = 2;
export const BUILT = 3;
export const STALL = 4;

/** Bakery footprint and the tile the oven door opens onto. */
export const BAKERY = { gx: 86, gy: 56, w: 4, d: 4 };
export const DOOR = { gx: 88, gy: 61 };

export const FOUNTAIN = { gx: 79, gy: 79, w: 2, d: 2 };

export interface Gate {
  readonly gx: number;
  readonly gy: number;
  readonly w: number;
  readonly d: number;
  open: boolean;
}

export interface House {
  readonly gx: number;
  readonly gy: number;
  readonly seed: number;
  readonly kind: 0 | 1 | 2;
}

export interface Market {
  readonly seed: number;
  readonly heights: TileGrid;
  readonly kind: TileGrid;
  readonly occupy: TileGrid;
  readonly field: HeightField;
  readonly routes: readonly Path[];
  readonly gates: Gate[];
  readonly houses: House[];
  readonly maxHeightPx: number;
}

/** Camera opening: the square, the bakery, the fence — not the whole map. */
export const HEART: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

function inSquare(gx: number, gy: number): boolean {
  return gx >= 58 && gx < 104 && gy >= 58 && gy < 106;
}

function heightUnits(gx: number, gy: number): number {
  const dx = gx - 82;
  const dy = gy - 78;
  const d = Math.sqrt(dx * dx * 0.72 + dy * dy);
  const bowl = d < 26 ? 5.4 : d < 38 ? 5.4 - (d - 26) * 0.22 : 2.2;
  const hill = Math.max(0, fbm2(SEED, gx * 0.045, gy * 0.028, 4) * 7.2 - 1.6);
  const ridge = fbm2(SEED ^ 0x51, gx * 0.09, gy * 0.02, 3) * 2.4;
  if (inSquare(gx, gy)) return bowl + 0.35;
  return bowl + hill + Math.max(0, ridge);
}

function kindAt(gx: number, gy: number): number {
  if (inSquare(gx, gy)) return PAVE;
  const track = Math.abs((gx - gy) - 4) < 2 && gx > 40 && gx < 120;
  return track ? ROAD : GRASS;
}

function ring(cx: number, cy: number, rx: number, ry: number, n: number): Path {
  const path = new Path(n + 2);
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * Math.PI * 2;
    /* @tier-b pixels only */
    path.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return path;
}

function layFence(occupy: TileGrid): void {
  for (let x = 84; x <= 93; x++) occupy.set(x, 62, WALL);
  for (let y = 56; y <= 62; y++) {
    occupy.set(84, y, WALL);
    occupy.set(93, y, WALL);
  }
  for (let x = 86; x < 90; x++) {
    for (let y = 56; y < 60; y++) occupy.set(x, y, BUILT);
  }
  occupy.set(FOUNTAIN.gx, FOUNTAIN.gy, BUILT);
  occupy.set(FOUNTAIN.gx + 1, FOUNTAIN.gy, BUILT);
  occupy.set(FOUNTAIN.gx, FOUNTAIN.gy + 1, BUILT);
  occupy.set(FOUNTAIN.gx + 1, FOUNTAIN.gy + 1, BUILT);
}

function plantHouses(occupy: TileGrid): House[] {
  const out: House[] = [];
  for (let gy = 48; gy < 116; gy += 5) {
    for (let gx = 46; gx < 118; gx += 5) {
      if (gx >= 56 && gx < 106 && gy >= 54 && gy < 108) continue;
      if (toUnit(hash2(SEED ^ 0x11, gx, gy)) < 0.42) continue;
      if (gx + 2 >= W || gy + 2 >= H) continue;
      let clear = true;
      for (let y = gy; y < gy + 3 && clear; y++) {
        for (let x = gx; x < gx + 3; x++) {
          if (occupy.get(x, y) !== FREE || kindAt(x, y) === PAVE) clear = false;
        }
      }
      if (!clear) continue;
      for (let y = gy; y < gy + 3; y++) {
        for (let x = gx; x < gx + 3; x++) occupy.set(x, y, BUILT);
      }
      const kind = (hash2(SEED, gx, gy) % 3) as 0 | 1 | 2;
      out.push({ gx, gy, seed: hash2(SEED, gx, gy), kind });
    }
  }
  return out;
}

export function createMarket(): Market {
  const heights = new TileGrid(W + 1, H + 1, { bits: 8 });
  const kind = new TileGrid(W, H, { bits: 8, outOfBounds: GRASS });
  const occupy = new TileGrid(W, H, { bits: 8, outOfBounds: WALL });
  heights.fillFrom((gx, gy) => Math.max(0, Math.round(heightUnits(gx, gy))));
  kind.fillFrom(kindAt);
  occupy.fill(FREE);
  layFence(occupy);
  const houses = plantHouses(occupy);

  const gates: Gate[] = [
    { gx: 87, gy: 62, w: 2, d: 1, open: false },
    { gx: 84, gy: 59, w: 1, d: 2, open: false },
    { gx: 93, gy: 59, w: 1, d: 2, open: false },
  ];
  for (const g of gates) markGate(occupy, g);

  const routes = [
    ring(80, 80, 9.2, 9.2, 36),
    ring(80, 80, 11.4, 11.4, 40),
    ring(80, 80, 16.6, 15.2, 52),
    ring(80, 80, 18.8, 17.2, 56),
    ring(80, 80, 23.4, 21.6, 68),
    ring(80, 80, 25.6, 23.6, 72),
  ];

  let maxU = 0;
  for (let gy = 0; gy < H + 1; gy++) {
    for (let gx = 0; gx < W + 1; gx++) {
      const u = heights.get(gx, gy);
      if (u > maxU) maxU = u;
    }
  }

  return {
    seed: SEED,
    heights,
    kind,
    occupy,
    field: { heights, stepPx: STEP_PX },
    routes,
    gates,
    houses,
    maxHeightPx: maxU * STEP_PX,
  };
}

export function markGate(occupy: TileGrid, gate: Gate): void {
  const value = gate.open ? FREE : CLOSED;
  for (let y = 0; y < gate.d; y++) {
    for (let x = 0; x < gate.w; x++) occupy.set(gate.gx + x, gate.gy + y, value);
  }
}

export function canPlace(m: Market, gx: number, gy: number, w: number, d: number): boolean {
  if (gx < 1 || gy < 1 || gx + w >= W - 1 || gy + d >= H - 1) return false;
  for (let y = gy; y < gy + d; y++) {
    for (let x = gx; x < gx + w; x++) {
      if (!m.kind.has(x, y)) return false;
      if (m.occupy.get(x, y) !== FREE) return false;
      if (m.kind.get(x, y) === GRASS) return false;
    }
  }
  return true;
}

export function stamp(m: Market, gx: number, gy: number, w: number, d: number, value: number): void {
  for (let y = gy; y < gy + d; y++) {
    for (let x = gx; x < gx + w; x++) m.occupy.set(x, y, value);
  }
}
