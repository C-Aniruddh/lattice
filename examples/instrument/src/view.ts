/**
 * The hall: floor, pipes, the waveform each scheduled voice draws in the air.
 *
 * @art
 *
 * Delete this file and the exhibit still unlocks, still plays, still knows which pipe was
 * struck — on a black canvas. Nothing here is a number the player is playing for. The
 * waveforms are driven from copies of `Audio.onScheduled` plans, because `@latticekit/audio`
 * ships no `AnalyserNode` and its header says why: a visualiser that needs a real device is
 * invisible to tests, and the plan is the beat.
 */
import { hash2, toUnit } from '@latticekit/core';
import { glowDot, isoCylinder, isoPost, isoTile, levelsToPx, renderFrame, type Ink, type Passes, type Pen } from '@latticekit/draw';
import { worldToGridX, worldToGridY, type DepthSorter, type TileRange } from '@latticekit/iso';
import type { Wave } from '@latticekit/audio';
import { createBucket, type Bucket } from '../../_shared/src/index.js';
import { H, W, MAX_HEIGHT_PX, hasPipe, pipeH, waveAt } from './board.js';
import { WORKSHOP, WORKSHOP_NIGHT } from './palette.js';

/** One scheduled layer, copied out of the reused `VoicePlan` on the line it was read. */
export interface Voice {
  source: string;
  wave: Wave;
  hz: number;
  gain: number;
  start: number;
  end: number;
  gx: number;
  gy: number;
}

export interface Look {
  seed: number;
  now: number;
  woke: boolean;
  voices: readonly Voice[];
}

type Pipe = { gx: number; gy: number; h: number };

const DARKNESS = 0.18;
const POOL_MAX = 14;

let bucket: Bucket<Pipe> | undefined;
let frame: Pen | undefined;
let view: Look | undefined;
let passes: Passes | undefined;
let camGx = 0;
let camGy = 0;

function snap(x: number): number {
  return Math.round(x * 8) / 8;
}

function waveInk(wave: Wave): Ink {
  if (wave === 'sine') return 'teal';
  if (wave === 'triangle') return 'brand';
  if (wave === 'square') return 'metal';
  if (wave === 'sawtooth') return 'brass';
  return 'ember';
}

function floorInk(gx: number, gy: number): Ink {
  return waveInk(waveAt(gx, gy));
}

/** Shape of one sample. `Math.sin` is pixels only — the pitch itself is the plan's `hz`. */
function shape(wave: Wave, phase: number, seed: number, i: number): number {
  const t = phase - Math.floor(phase);
  if (wave === 'sine') return Math.sin(phase * Math.PI * 2);
  if (wave === 'triangle') return 4 * Math.abs(t - 0.5) - 1;
  if (wave === 'square') return t < 0.5 ? 1 : -1;
  if (wave === 'sawtooth') return t * 2 - 1;
  return toUnit(hash2(seed ^ i, (phase * 64) | 0, i)) * 2 - 1;
}

function liveAt(look: Look, gx: number, gy: number): Voice | undefined {
  for (let i = 0; i < look.voices.length; i += 1) {
    const v = look.voices[i];
    if (v !== undefined && v.gx === gx && v.gy === gy && v.end > look.now && v.source !== 'bed') return v;
  }
  return undefined;
}

const paint = (pipe: Pipe): void => {
  const pen = frame;
  const look = view;
  if (pen === undefined || look === undefined) return;
  const toward = pipe.gx + pipe.gy - camGx - camGy;
  const near = toward > -1 && toward < 11 && Math.abs(pipe.gx - camGx) < 13;
  const voice = liveAt(look, pipe.gx, pipe.gy);
  const ink: Ink = voice !== undefined ? waveInk(voice.wave) : near ? 'brass' : toward < -8 ? 'metal' : 'brass';
  if (near) {
    isoCylinder(pen, pipe.gx + 0.5, pipe.gy + 0.5, 0.32, { color: ink, h: pipe.h });
    isoCylinder(pen, pipe.gx + 0.5, pipe.gy + 0.5, 0.38, { color: 'metal', h: 0.1, z: pipe.h });
  } else {
    isoPost(pen, pipe.gx + 0.5, pipe.gy + 0.5, 0, pipe.h * (toward < -10 ? 0.5 : 0.78), ink, toward < -10 ? 0.2 : 0.3);
  }
  if (voice !== undefined) {
    glowDot(pen, pipe.gx + 0.5, pipe.gy + 0.5, pipe.h + 0.25, waveInk(voice.wave), 0.16, snap(Math.min(1, voice.gain * 5)));
  }
};

function fillPipes(visible: Readonly<TileRange>, look: Look, list: Bucket<Pipe>): void {
  const gx0 = Math.max(0, visible.gx0 | 0);
  const gy0 = Math.max(0, visible.gy0 | 0);
  const gx1 = Math.min(W, visible.gx1 | 0);
  const gy1 = Math.min(H, visible.gy1 | 0);
  for (let gy = gy0; gy < gy1; gy += 1) {
    for (let gx = gx0; gx < gx1; gx += 1) {
      if (!hasPipe(look.seed, gx, gy)) continue;
      const h = pipeH(look.seed, gx, gy);
      list.add({ gx, gy, h }, gx, gy, 1, 1, levelsToPx(h + 0.2));
    }
  }
}

function paintFloor(pen: Pen, visible: Readonly<TileRange>): void {
  const gx0 = Math.max(0, visible.gx0 | 0);
  const gy0 = Math.max(0, visible.gy0 | 0);
  const gx1 = Math.min(W, visible.gx1 | 0);
  const gy1 = Math.min(H, visible.gy1 | 0);
  for (let gy = gy0; gy < gy1; gy += 1) {
    for (let gx = gx0; gx < gx1; gx += 1) {
      isoTile(pen, gx, gy, floorInk(gx, gy), 'ink', 0.04);
    }
  }
}

function pools(pen: Pen): void {
  const field = pen.light;
  const look = view;
  if (field === undefined || look === undefined) return;
  const cx = worldToGridX(pen.camera.x, pen.camera.y);
  const cy = worldToGridY(pen.camera.x, pen.camera.y);
  // A walking spark so the first frame is a game, not a screenshot — it does not wait for a gesture.
  const spark = snap(0.5 + 0.2 * Math.sin(pen.t * 5));
  let spent = 0;
  for (let k = 0; k < 3; k += 1) {
    const chase = (((pen.t * 2.4) | 0) + k * 11) % 40;
    const sgx = Math.max(0, Math.min(W - 1, (cx | 0) + (chase % 10) - 4));
    const sgy = Math.max(0, Math.min(H - 1, (cy | 0) + ((chase / 5) | 0) - 3));
    field.add(sgx + 0.5, sgy + 0.5, 0, 2.4, spark, 'ember');
    field.add(sgx + 0.5, sgy + 0.5, 0, 7, spark * 0.3, 'ember');
    spent += 1;
  }
  for (let i = 0; i < look.voices.length && spent < POOL_MAX; i += 1) {
    const v = look.voices[i];
    if (v === undefined || v.end <= look.now) continue;
    const fade = snap(Math.max(0, (v.end - look.now) / Math.max(0.05, v.end - v.start)));
    if (v.source === 'bed') {
      field.add(cx, cy, 0, 14, snap(0.18 * fade), 'teal');
      spent += 1;
      continue;
    }
    const hPx = levelsToPx(pipeH(look.seed, v.gx, v.gy));
    const ink = waveInk(v.wave);
    field.add(v.gx + 0.5, v.gy + 0.5, hPx, 2.4, fade, ink);
    field.add(v.gx + 0.5, v.gy + 0.5, hPx, 7, fade * 0.32, ink);
    spent += 1;
  }
}

function ribbons(pen: Pen): void {
  const look = view;
  if (look === undefined) return;
  for (let k = 0; k < 3; k += 1) {
    const chase = (((pen.t * 2.4) | 0) + k * 11) % 40;
    const sgx = Math.max(0, Math.min(W - 1, (camGx | 0) + (chase % 10) - 4));
    const sgy = Math.max(0, Math.min(H - 1, (camGy | 0) + ((chase / 5) | 0) - 3));
    glowDot(pen, sgx + 0.5, sgy + 0.5, 2.6, 'ember', 0.28, snap(0.6 + 0.3 * Math.sin(pen.t * 6 + k)));
  }
  for (let i = 0; i < look.voices.length; i += 1) {
    const v = look.voices[i];
    if (v === undefined || v.end <= look.now || v.source === 'bed') continue;
    const life = (look.now - v.start) / Math.max(0.04, v.end - v.start);
    if (life < 0 || life >= 1) continue;
    const fade = snap(1 - life);
    const h0 = pipeH(look.seed, v.gx, v.gy) + 0.6;
    const ink = waveInk(v.wave);
    const n = 22;
    for (let s = 0; s < n; s += 1) {
      const u = s / (n - 1);
      const phase = (look.now - v.start) * v.hz * 0.06 + u * 3.2;
      const amp = shape(v.wave, phase, look.seed, s) * Math.min(2.2, v.gain * 12) * fade;
      glowDot(pen, v.gx + 0.5 + u * 2.4 - 1.2, v.gy + 0.5, h0 + amp, ink, 0.18, fade);
    }
  }
}

function makePasses(): Passes {
  return {
    maxHeightPx: MAX_HEIGHT_PX,
    terrain: (pen, visible) => {
      const look = view;
      const list = bucket;
      if (look === undefined || list === undefined) return;
      paintFloor(pen, visible);
      fillPipes(visible, look, list);
    },
    solids: () => bucket?.each(paint),
    placement: (pen) => pools(pen),
    overlay: (pen) => ribbons(pen),
  };
}

/**
 * One frame of hall. Palette and darkness are the same number so the brass and the night
 * cannot disagree.
 */
export function drawHall(pen: Pen, order: DepthSorter, look: Look): void {
  frame = pen;
  view = look;
  camGx = worldToGridX(pen.camera.x, pen.camera.y);
  camGy = worldToGridY(pen.camera.x, pen.camera.y);
  // One lerp, on the first frame: a continuous dusk is an animated color, and that is an allocator.
  if (pen.t < 0.05) pen.palette.lerp(WORKSHOP_NIGHT, WORKSHOP, 0.7);
  pen.light?.begin(pen, DARKNESS, 'night');
  const list = (bucket ??= createBucket<Pipe>(order));
  list.clear();
  renderFrame(pen, (passes ??= makePasses()), order);
}
