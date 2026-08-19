import { createScope, hash2, toUnit } from '@latticekit/core';
import {
  DepthSorter,
  boxSilhouette,
  createCamera,
  pickSorted,
  pointInPolygon,
  screenToTileOnHeights,
  tileBounds,
  type GridPoint,
  type Rect,
  type Tile,
  type TileRange,
  type Volume,
} from '@latticekit/iso';
import {
  beginFrame,
  createCanvas2dSurface,
  createLightField,
  createPalette,
  drawGhost,
  drawSprite,
  endFrame,
  renderFrame,
  spriteHeightPx,
  spriteVolume,
  type Passes,
  type Pen,
  type SpriteDef,
  type Variant,
} from '@latticekit/draw';
import { browserFrames, createLoop, createTweens } from '@latticekit/loop';
import { createInput } from '@latticekit/input';
import { drive } from '@latticekit/ui';
import { DAY_X, DUSK_X } from './palette.js';
import {
  BAKERY,
  CLOSED,
  FOUNTAIN,
  GRASS,
  HEART,
  W,
  H,
  WALL,
  createMarket,
} from './world.js';
import {
  BAKERY_SPRITE,
  BAKERY_VARIANT,
  CART_SPRITE,
  FENCE_SPRITE,
  FOUNTAIN_SPRITE,
  GATE_SPRITE,
  GATE_TALL,
  HOUSE_SPRITE,
  STALL_SPRITE,
  TREE_SPRITE,
} from './sprites.js';
import {
  createSession,
  dayT,
  gateAt,
  groundAt,
  placeStall,
  remainingMs,
  restart,
  stallsLeft,
  stepCrowd,
  tickClock,
  toggleGate,
  walkerPose,
  type Session,
} from './game.js';
import { drawPerson } from './people.js';
import { drawGround, drawSky } from './ground.js';
import { createHud } from './hud.js';
import { audio, bed, unlockAudio } from './sound.js';

const KIND_BAKERY = 1;
const KIND_STALL = 2;
const KIND_GATE = 3;
const KIND_HOUSE = 4;
const KIND_TREE = 5;
const KIND_FENCE = 6;
const KIND_FOUNTAIN = 7;
const KIND_CART = 8;
const KIND_PERSON = 9;

interface Item {
  kind: number;
  gx: number;
  gy: number;
  id: number;
  zPx: number;
  seed: number;
}

const H_BAKERY = spriteHeightPx(BAKERY_SPRITE, BAKERY_VARIANT);
const H_STALL = spriteHeightPx(STALL_SPRITE, { ...BAKERY_VARIANT, seed: 1, label: '' });
const H_GATE = spriteHeightPx(GATE_SPRITE, { ...BAKERY_VARIANT, seed: 2, label: '', level: 0 });
const H_GATE_T = spriteHeightPx(GATE_TALL, { ...BAKERY_VARIANT, seed: 3, label: '', level: 0 });
const H_HOUSE = spriteHeightPx(HOUSE_SPRITE, { ...BAKERY_VARIANT, seed: 4, label: '' });
const H_TREE = spriteHeightPx(TREE_SPRITE, { ...BAKERY_VARIANT, seed: 5, label: '' });
const H_FENCE = spriteHeightPx(FENCE_SPRITE, { ...BAKERY_VARIANT, seed: 6, label: '' });
const H_FOUNT = spriteHeightPx(FOUNTAIN_SPRITE, { ...BAKERY_VARIANT, seed: 8, label: '' });
const H_CART = spriteHeightPx(CART_SPRITE, { ...BAKERY_VARIANT, seed: 9, label: '' });

const host = document.getElementById('app') ?? document.body;
const canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:100%';
host.append(canvas);

const scope = createScope();
const surface = createCanvas2dSurface(canvas);
const palette = createPalette(DAY_X);

const market = createMarket();
tileBounds(0, 0, W, H, market.maxHeightPx + 80, HEART);
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(66, 60, 34, 32, market.maxHeightPx + 80, opening);

const camera = createCamera(Math.max(1, innerWidth), Math.max(1, innerHeight), {
  bounds: HEART,
  minZoom: 0.28,
  keepVisible: 0.45,
});
camera.fitBounds(opening, 20);

const light = createLightField(surface, { scale: 0.55, falloff: 1.1, bloom: 0.28 });
const order = new DepthSorter(4096);
const tweens = createTweens();
const now = (): number => performance.now();
const loop = createLoop({ clock: { now }, frames: browserFrames() });

const input = createInput({
  element: canvas,
  camera,
  step: loop,
  actions: { touch: ['tap'] },
});

const session: Session = createSession(market, now());
if (new URLSearchParams(location.search).has('demo')) {
  placeStall(session, 74, 86);
  placeStall(session, 88, 78);
  toggleGate(session, 0);
}
const items: Item[] = [];
const carts: { gx: number; gy: number; seed: number }[] = [];
for (let gy = 64; gy < 102; gy += 3) {
  for (let gx = 62; gx < 102; gx += 3) {
    if (toUnit(hash2(market.seed ^ 0xca, gx, gy)) < 0.82) continue;
    if (market.occupy.get(gx, gy) !== 0) continue;
    if (market.kind.get(gx, gy) === GRASS) continue;
    carts.push({ gx, gy, seed: hash2(market.seed, gx, gy) });
  }
}

const pose: GridPoint = { gx: 0, gy: 0 };
const vis: TileRange = { gx0: 0, gy0: 0, gx1: 0, gy1: 0 };
const hit: Tile = { gx: 0, gy: 0 };
const hover: { x: number; y: number } = { x: 0, y: 0 };
const ghost: Tile = { gx: -1, gy: -1 };
const vol: Volume = { ox: 0, oy: 0, w: 0, d: 0, zPx: 0, hPx: 0 };
const outline = new Float64Array(12);
const variants = new Map<number, Variant>();

function variantOf(seed: number, extra: Partial<Variant> = {}): Variant {
  let v = variants.get(seed);
  if (v === undefined) {
    v = { level: 0, seed, flags: 0, progress: 1, label: '' };
    variants.set(seed, v);
  }
  if (extra.level !== undefined && extra.level !== v.level) {
    v = { ...v, level: extra.level };
    variants.set(seed, v);
  }
  return v;
}

function put(kind: number, gx: number, gy: number, w: number, d: number, hPx: number, id: number, zPx: number, seed: number): void {
  const slot = order.add(gx, gy, w, d, zPx + hPx);
  let it = items[slot];
  if (it === undefined) {
    it = { kind, gx, gy, id, zPx, seed };
    items[slot] = it;
  } else {
    it.kind = kind;
    it.gx = gx;
    it.gy = gy;
    it.id = id;
    it.zPx = zPx;
    it.seed = seed;
  }
}

function pickTile(sx: number, sy: number): Tile | null {
  return screenToTileOnHeights(camera, sx, sy, market.field, market.maxHeightPx, hit) ? hit : null;
}

function hitsGate(index: number): boolean {
  const it = items[index];
  if (it === undefined || it.kind !== KIND_GATE) return false;
  const gate = market.gates[it.id];
  if (gate === undefined) return false;
  const def = gate.w > gate.d ? GATE_SPRITE : GATE_TALL;
  const v = variantOf(it.seed, { level: gate.open ? 1 : 0 });
  spriteVolume(def, v, vol, it.zPx);
  boxSilhouette(camera, it.gx, it.gy, vol, outline);
  return pointInPolygon(pickSx, pickSy, outline, 6);
}

let pickSx = 0;
let pickSy = 0;

input.onAction('touch', (a) => {
  unlockAudio();
  pickSx = a.sx;
  pickSy = a.sy;
  if (order.sorted) {
    const at = pickSorted(order, hitsGate);
    if (at >= 0) {
      const it = items[at];
      if (it !== undefined && toggleGate(session, it.id)) {
        audio.play('gate');
        return;
      }
    }
  }
  const tile = pickTile(a.sx, a.sy);
  if (tile === undefined || tile === null) {
    audio.play('deny');
    return;
  }
  const gi = gateAt(session, tile.gx, tile.gy);
  if (gi >= 0) {
    if (toggleGate(session, gi)) audio.play('gate');
    else audio.play('deny');
    return;
  }
  if (placeStall(session, tile.gx, tile.gy)) audio.play('place');
  else audio.play('deny');
});

function fit(): void {
  const w = Math.max(1, innerWidth);
  const h = Math.max(1, innerHeight);
  surface.resize(w, h, surface.pixelRatio);
  camera.resize(w, h);
  camera.fitBounds(opening, 20);
}
addEventListener('resize', fit);
visualViewport?.addEventListener('resize', fit);
scope.add(() => {
  removeEventListener('resize', fit);
  visualViewport?.removeEventListener('resize', fit);
});
fit();

const hud = createHud(palette, now, () => {
  const left = remainingMs(session, now());
  let hint = 'Tap the cobbles to set a stall. Tap a closed gate to open it.';
  if (session.closed) hint = 'The market is shut. The oven keeps the last of the heat.';
  else if (session.stalls.length === 0) hint = 'Set a stall in the stream — people peel off when they smell the bread.';
  else if (market.gates.every((g) => !g.open)) hint = 'They are piling up at the fence. Open a gate.';
  else hint = 'Keep the trail going. The bell is coming.';
  return {
    customers: session.customers,
    remainingMs: left,
    stalls: stallsLeft(session),
    closed: session.closed,
    hint,
  };
}, () => {
  restart(session, now());
  audio.play('place');
});
scope.add(drive(hud.ui, loop));
scope.add(() => hud.destroy());

loop.onUpdate((dt, tick) => {
  input.tick(tick);
  const arrived = stepCrowd(session, dt, loop.realTime);
  if (arrived > 0) audio.play('sale');
  if (tickClock(session, now()) && !session.lastBell) {
    session.lastBell = true;
    audio.play('bell');
  }
  const dusk = dayT(session, now());
  palette.lerp(DUSK_X, DAY_X, 1 - dusk);
  bed.set(0.35 + Math.min(1, session.customers / 40) * 0.4, 1 - dusk * 0.55);
  tweens.step(dt);
});

function paintItem(pen: Pen, it: Item): void {
  const seed = it.seed;
  if (it.kind === KIND_PERSON) {
    const dir = walkerPose(session, it.id, loop.realTime, pose);
    const w = session.walkers[it.id];
    drawPerson(pen, it.id, it.gx, it.gy, it.zPx, dir, w?.hooked === true);
    return;
  }
  let def: SpriteDef = TREE_SPRITE;
  let v: Variant = variantOf(seed);
  if (it.kind === KIND_BAKERY) {
    def = BAKERY_SPRITE;
    v = BAKERY_VARIANT;
  } else if (it.kind === KIND_STALL) {
    def = STALL_SPRITE;
  } else if (it.kind === KIND_GATE) {
    const gate = market.gates[it.id];
    def = gate !== undefined && gate.w > gate.d ? GATE_SPRITE : GATE_TALL;
    v = variantOf(seed, { level: gate?.open ? 1 : 0 });
  } else if (it.kind === KIND_HOUSE) {
    def = HOUSE_SPRITE;
  } else if (it.kind === KIND_FENCE) {
    def = FENCE_SPRITE;
  } else if (it.kind === KIND_FOUNTAIN) {
    def = FOUNTAIN_SPRITE;
  } else if (it.kind === KIND_CART) {
    def = CART_SPRITE;
  }
  drawSprite(pen, def, it.gx, it.gy, v, it.zPx);
}

const passes: Passes = {
  maxHeightPx: market.maxHeightPx,
  backdrop: (pen) => {
    drawSky(pen);
  },
  terrain: (pen, visible) => {
    drawGround(pen, market, visible);
  },
  solids: (pen, sorted) => {
    for (let i = 0; i < sorted.count; i++) {
      const it = items[sorted.indexAt(i)];
      if (it !== undefined) paintItem(pen, it);
    }
  },
  placement: (pen) => {
    if (ghost.gx < 0 || session.closed || stallsLeft(session) <= 0) return;
    const legal = market.occupy.get(ghost.gx, ghost.gy) === 0;
    const z = groundAt(session, ghost.gx + 1, ghost.gy + 1);
    drawGhost(pen, STALL_SPRITE, ghost.gx, ghost.gy, variantOf(99), legal, z);
  },
};

loop.onRender((_alpha, time, nowMs) => {
  input.frame(nowMs);
  if (input.pointerScreen(hover)) {
    const tile = pickTile(hover.x, hover.y);
    if (tile) {
      ghost.gx = tile.gx;
      ghost.gy = tile.gy;
    } else {
      ghost.gx = -1;
    }
  } else {
    ghost.gx = -1;
  }

  const dusk = dayT(session, nowMs);
  const pen = beginFrame({ surface, camera, palette, t: time, clear: 'sky', light });
  light.begin(pen, 0.14 + dusk * 0.36, 'night');
  order.clear();
  camera.visibleTileBounds(vis, Math.ceil(market.maxHeightPx / 32) + 2);

  const zBakery = groundAt(session, BAKERY.gx + 2, BAKERY.gy + 2);
  put(KIND_BAKERY, BAKERY.gx, BAKERY.gy, BAKERY.w, BAKERY.d, H_BAKERY, 0, zBakery, 7);

  const zFount = groundAt(session, FOUNTAIN.gx + 1, FOUNTAIN.gy + 1);
  put(KIND_FOUNTAIN, FOUNTAIN.gx, FOUNTAIN.gy, 2, 2, H_FOUNT, 0, zFount, 8);

  for (let i = 0; i < market.gates.length; i++) {
    const g = market.gates[i];
    if (g === undefined) continue;
    const z = groundAt(session, g.gx + g.w * 0.5, g.gy + g.d * 0.5);
    put(KIND_GATE, g.gx, g.gy, g.w, g.d, g.w > g.d ? H_GATE : H_GATE_T, i, z, 20 + i);
  }

  for (let i = 0; i < market.houses.length; i++) {
    const h = market.houses[i];
    if (h === undefined) continue;
    if (h.gx + 3 < vis.gx0 || h.gy + 3 < vis.gy0 || h.gx > vis.gx1 || h.gy > vis.gy1) continue;
    const z = groundAt(session, h.gx + 1.5, h.gy + 1.5);
    put(KIND_HOUSE, h.gx, h.gy, 3, 3, H_HOUSE, i, z, h.seed);
  }

  for (let i = 0; i < session.stalls.length; i++) {
    const st = session.stalls[i];
    if (st === undefined) continue;
    const z = groundAt(session, st.gx + 1, st.gy + 1);
    put(KIND_STALL, st.gx, st.gy, 2, 2, H_STALL, i, z, st.seed);
  }

  for (const c of carts) {
    if (c.gx < vis.gx0 || c.gy < vis.gy0 || c.gx > vis.gx1 || c.gy > vis.gy1) continue;
    if (market.occupy.get(c.gx, c.gy) !== 0) continue;
    const z = groundAt(session, c.gx + 0.5, c.gy + 0.5);
    put(KIND_CART, c.gx, c.gy, 1, 1, H_CART, 0, z, c.seed);
  }

  const x0 = Math.max(0, vis.gx0);
  const y0 = Math.max(0, vis.gy0);
  const x1 = Math.min(W, vis.gx1);
  const y1 = Math.min(H, vis.gy1);
  for (let gy = y0; gy < y1; gy++) {
    for (let gx = x0; gx < x1; gx++) {
      const occ = market.occupy.get(gx, gy);
      if (occ === WALL || occ === CLOSED) {
        const onGate = gateAt(session, gx, gy) >= 0;
        if (!onGate) {
          const z = groundAt(session, gx + 0.5, gy + 0.5);
          put(KIND_FENCE, gx, gy, 1, 1, H_FENCE, 0, z, gx * 131 + gy);
        }
      }
      if (market.kind.get(gx, gy) !== GRASS) continue;
      if (occ !== 0) continue;
      if (toUnit(hash2(market.seed ^ 0x7ee, gx, gy)) < 0.86) continue;
      const z = groundAt(session, gx + 0.5, gy + 0.5);
      put(KIND_TREE, gx, gy, 1, 1, H_TREE, 0, z, hash2(market.seed, gx, gy));
    }
  }

  for (let i = 0; i < session.walkers.length; i++) {
    const dir = walkerPose(session, i, time, pose);
    void dir;
    const z = groundAt(session, pose.gx, pose.gy);
    const slot = order.addPoint(pose.gx, pose.gy, z + 22, 0.16);
    let it = items[slot];
    if (it === undefined) {
      it = { kind: KIND_PERSON, gx: pose.gx, gy: pose.gy, id: i, zPx: z, seed: i };
      items[slot] = it;
    } else {
      it.kind = KIND_PERSON;
      it.gx = pose.gx;
      it.gy = pose.gy;
      it.id = i;
      it.zPx = z;
      it.seed = i;
    }
  }

  renderFrame(pen, passes, order);
  endFrame(pen);
});

(globalThis as Record<string, unknown>).__lattice = {
  loop,
  order,
  camera,
  session,
  place: (gx: number, gy: number) => placeStall(session, gx, gy),
  open: (i: number) => toggleGate(session, i),
};

function dispose(): void {
  loop.stop();
  input.dispose();
  light.dispose();
  audio.dispose();
  scope.dispose();
  canvas.remove();
}
if (import.meta.hot) import.meta.hot.dispose(dispose);

loop.start();
