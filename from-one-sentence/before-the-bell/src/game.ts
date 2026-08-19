import { hash2, mod, toUnit } from '@latticekit/core';
import {
  DIR_DX,
  DIR_DY,
  FlowField,
  heightAt,
  pathDirAt,
  pathSample,
  type GridPoint,
} from '@latticekit/iso';
import {
  BAKERY,
  BUILT,
  CLOSED,
  DOOR,
  FREE,
  PAVE,
  STALL,
  WALL,
  canPlace,
  markGate,
  stamp,
  type Market,
} from './world.js';

const PHI = 0.6180339887498949;
const WHO = 0x0b0e7e;
const LANE = [0, 2, 4, 1, 3, 5, 2, 4, 0, 3, 5, 1, 4, 2, 5, 3];
const STALL_LIMIT = 6;
const SHIFT_MS = 90_000;
const CROWD = 240;
const PULL = 3.4;
const WALK = 2.15;

export interface Stall {
  readonly gx: number;
  readonly gy: number;
  readonly seed: number;
}

export interface Walker {
  hooked: boolean;
  gx: number;
  gy: number;
}

export interface Session {
  readonly market: Market;
  readonly walkers: Walker[];
  readonly stalls: Stall[];
  readonly field: FlowField;
  customers: number;
  startedAt: number;
  closed: boolean;
  lastBell: boolean;
}

const here: GridPoint = { gx: 0, gy: 0 };

export function createSession(market: Market, nowMs: number): Session {
  const walkers: Walker[] = [];
  for (let i = 0; i < CROWD; i++) walkers.push({ hooked: false, gx: 80, gy: 80 });
  const field = new FlowField(50, 50, 64, 64);
  const session: Session = {
    market,
    walkers,
    stalls: [],
    field,
    customers: 0,
    startedAt: nowMs,
    closed: false,
    lastBell: false,
  };
  rebuild(session);
  return session;
}

export function remainingMs(s: Session, nowMs: number): number {
  return Math.max(0, SHIFT_MS - (nowMs - s.startedAt));
}

export function stallsLeft(s: Session): number {
  return STALL_LIMIT - s.stalls.length;
}

export function dayT(s: Session, nowMs: number): number {
  return 1 - remainingMs(s, nowMs) / SHIFT_MS;
}

function tileCost(s: Session, gx: number, gy: number): number {
  const occ = s.market.occupy.get(gx, gy);
  if (occ === WALL || occ === CLOSED || occ === BUILT) return 0;
  if (occ === STALL) return 1;
  const kind = s.market.kind.get(gx, gy);
  return kind === PAVE ? 1 : 2;
}

export function rebuild(s: Session): void {
  s.field.clearGoals();
  s.field.addGoal(DOOR.gx, DOOR.gy);
  s.field.build((gx, gy) => tileCost(s, gx, gy), { bounds: s.field.range }, s.market.occupy.version);
}

function nearStall(s: Session, gx: number, gy: number): boolean {
  for (const stall of s.stalls) {
    const dx = gx - (stall.gx + 1);
    const dy = gy - (stall.gy + 1);
    if (dx * dx + dy * dy < PULL * PULL) return true;
  }
  return false;
}

export function walkerPose(s: Session, i: number, t: number, out: GridPoint): number {
  const w = s.walkers[i];
  if (w === undefined) return 0;
  if (w.hooked) {
    out.gx = w.gx;
    out.gy = w.gy;
    const dir = s.field.dirAt(Math.floor(w.gx), Math.floor(w.gy));
    return dir;
  }
  const lane = LANE[i % LANE.length] ?? 0;
  const route = s.market.routes[lane];
  if (route === undefined || route.arcLength <= 0) return 0;
  const pace = 0.68 + toUnit(hash2(WHO, i, 7)) * 0.7;
  const back = (lane & 1) === 1;
  const span = route.arcLength;
  const arc = mod(PHI * i + ((back ? -t : t) * 30 * pace) / span, 1) * span;
  pathSample(route, arc, out);
  const code = pathDirAt(route, arc);
  return code === 0 || !back ? code : ((code + 3) % 8) + 1;
}

export function stepCrowd(s: Session, dt: number, t: number): number {
  let arrivals = 0;
  if (s.closed) {
    for (let i = 0; i < s.walkers.length; i++) walkerPose(s, i, t, here);
    return 0;
  }
  for (let i = 0; i < s.walkers.length; i++) {
    const w = s.walkers[i];
    if (w === undefined) continue;
    if (!w.hooked) {
      walkerPose(s, i, t, here);
      w.gx = here.gx;
      w.gy = here.gy;
      if (s.stalls.length > 0 && nearStall(s, w.gx, w.gy)) w.hooked = true;
      continue;
    }
    const tx = Math.floor(w.gx);
    const ty = Math.floor(w.gy);
    const dx = w.gx - (DOOR.gx + 0.5);
    const dy = w.gy - (DOOR.gy + 0.5);
    if (dx * dx + dy * dy < 1.7) {
      w.hooked = false;
      arrivals += 1;
      continue;
    }
    const dir = s.field.dirAt(tx, ty);
    if (dir === 0) {
      w.hooked = false;
      continue;
    }
    const sx = DIR_DX[dir] ?? 0;
    const sy = DIR_DY[dir] ?? 0;
    const scale = sx !== 0 && sy !== 0 ? 0.72 : 1;
    w.gx += sx * WALK * dt * scale;
    w.gy += sy * WALK * dt * scale;
  }
  if (arrivals) s.customers += arrivals;
  return arrivals;
}

export function placeStall(s: Session, gx: number, gy: number): boolean {
  if (s.closed || stallsLeft(s) <= 0) return false;
  const x = gx | 0;
  const y = gy | 0;
  if (x >= BAKERY.gx - 1 && x < BAKERY.gx + BAKERY.w + 1 && y >= BAKERY.gy - 1 && y < BAKERY.gy + BAKERY.d + 2) {
    return false;
  }
  if (!canPlace(s.market, x, y, 2, 2)) return false;
  stamp(s.market, x, y, 2, 2, STALL);
  s.stalls.push({ gx: x, gy: y, seed: hash2(s.market.seed, x, y) });
  rebuild(s);
  return true;
}

export function toggleGate(s: Session, index: number): boolean {
  if (s.closed) return false;
  const gate = s.market.gates[index];
  if (gate === undefined) return false;
  gate.open = !gate.open;
  markGate(s.market.occupy, gate);
  rebuild(s);
  return true;
}

export function gateAt(s: Session, gx: number, gy: number): number {
  for (let i = 0; i < s.market.gates.length; i++) {
    const g = s.market.gates[i];
    if (g === undefined) continue;
    if (gx >= g.gx && gx < g.gx + g.w && gy >= g.gy && gy < g.gy + g.d) return i;
  }
  return -1;
}

export function tickClock(s: Session, nowMs: number): boolean {
  if (!s.closed && remainingMs(s, nowMs) <= 0) {
    s.closed = true;
    return true;
  }
  return false;
}

export function restart(s: Session, nowMs: number): void {
  for (const stall of s.stalls) stamp(s.market, stall.gx, stall.gy, 2, 2, FREE);
  s.stalls.length = 0;
  for (const g of s.market.gates) {
    g.open = false;
    markGate(s.market.occupy, g);
  }
  for (const w of s.walkers) w.hooked = false;
  s.customers = 0;
  s.startedAt = nowMs;
  s.closed = false;
  s.lastBell = false;
  rebuild(s);
}

export function groundAt(s: Session, gx: number, gy: number): number {
  return heightAt(s.market.field, gx, gy);
}
