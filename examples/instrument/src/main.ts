/**
 * INSTRUMENT — a Lattice exhibit. The wiring and the strike.
 *
 * A hall of pipes, each one an oscillator recipe. Nothing is loaded. The picture of a note
 * is the `VoicePlan` `@latticekit/audio` already emitted — copied on the line it is read,
 * because the plan object is reused. There is no `AnalyserNode`.
 *
 * **No boot in this file.** Canvas, camera, light, loop and input are `bootstrap()` from
 * `_shared`. **No drawing either**; that is `view.ts`. **No frequency**; that is `sound.ts`.
 *
 * The opening frame is silent on purpose. Browsers refuse an `AudioContext` until a gesture,
 * and this package installs no listener of its own. The HUD says so until the first tap.
 */
import { hashString } from '@latticekit/core';
import { gridToWorldX, tileBounds, type Rect } from '@latticekit/iso';
import { drive } from '@latticekit/ui';
import { createAudio, createBed, validateSounds } from '@latticekit/audio';
import { bootstrap, controlPanel, knobs } from '../../_shared/src/index.js';
import { WORKSHOP } from './palette.js';
import { H, W, MAX_HEIGHT_PX, hasPipe, soundId, stepAt, waveAt } from './board.js';
import { BED, SOUNDS } from './sound.js';
import { createHud } from './hud.js';
import { drawHall, type Look, type Voice } from './view.js';

const BED_GAIN = 0.58, DUCK_DEPTH = 0.62, RING = 24;
const worldRect: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const opening: Rect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
tileBounds(0, 0, W, H, MAX_HEIGHT_PX, worldRect);
tileBounds(W * 0.34, H * 0.30, 34, 34, MAX_HEIGHT_PX, opening);

const boot = bootstrap({
  seed: 'overtone', bounds: worldRect, background: '#140c14', palette: WORKSHOP, clear: 'sky', depth: 4096,
  camera: { zoom: 0.7, minZoom: 0.28, maxZoom: 2.4, keepVisible: 0.42 },
  light: { scale: 0.4, falloff: 1, bloom: 0.26 },
  actions: { play: ['tap'] }, terrain: 'flat',
});
boot.camera.fitBounds(opening, 18);

const seed = hashString(boot.seed);
const audio = createAudio<string>({ sounds: SOUNDS });
for (const problem of validateSounds(SOUNDS)) console.warn(problem.message);
const bed = createBed(audio, BED, { bus: 'music', sagTo: 0.8 });
audio.mixer.setGain('master', 0.68); audio.mixer.setGain('music', BED_GAIN);
boot.scope.add(() => { audio.dispose(); });

const empty = (): Voice => ({ source: '', wave: 'sine', hz: 0, gain: 0, start: 0, end: 0, gx: 0, gy: 0 });
const voices: Voice[] = Array.from({ length: RING }, empty);
const pending: { id: string; gx: number; gy: number }[] = Array.from({ length: 16 }, () => ({ id: '', gx: 0, gy: 0 }));
let pWrite = 0, vWrite = 0, woke = false, duck = 0, bedGain = BED_GAIN, lastHz = 0, lastWave = '—';
const look: Look = { seed, now: 0, woke: false, voices };

const hud = createHud({
  palette: boot.palette, now: () => boot.loop.realTime * 1000,
  read: () => ({ woke, hearing: audio.available, wave: lastWave, hz: lastHz, voices: audio.voices, worstMs: boot.worstMs }),
});
boot.scope.add(drive(hud.ui, boot)); boot.scope.add(hud.destroy);

function padOf(source: string): { gx: number; gy: number } {
  for (let i = 0; i < pending.length; i += 1) { const p = pending[i]; if (p !== undefined && p.id === source) return p; }
  return { gx: 0, gy: 0 };
}

boot.scope.add(audio.onScheduled((plan) => {
  duck = 1;
  const slot = voices[vWrite++ % RING], pad = plan.source === 'bed' ? { gx: 0, gy: 0 } : padOf(plan.source);
  if (slot === undefined) return;
  slot.source = plan.source; slot.wave = plan.wave; slot.hz = plan.hz; slot.gain = plan.gain;
  slot.start = plan.start; slot.end = plan.end; slot.gx = pad.gx; slot.gy = pad.gy;
  if (plan.source !== 'bed' && plan.layer === 0) { lastHz = plan.hz; lastWave = plan.wave; }
}));

function wake(): void {
  audio.unlock();
  if (!woke) { woke = true; look.woke = true; audio.play('wake'); }
}

function strike(gx: number, gy: number): void {
  const tx = gx | 0, ty = gy | 0;
  if (!hasPipe(seed, tx, ty)) return;
  wake();
  const id = soundId(waveAt(tx, ty), stepAt(seed, tx, ty));
  const slot = pending[pWrite++ % pending.length];
  if (slot === undefined) return;
  slot.id = id; slot.gx = tx; slot.gy = ty;
  audio.play(id, { pan: boot.camera.normalizedX(gridToWorldX(tx + 0.5, ty + 0.5)) });
}

boot.onAction('play', (e) => { strike(e.gx, e.gy); });

boot.onUpdate((dt) => {
  look.now = audio.now();
  duck = Math.max(0, duck - dt / 1.05);
  const want = Math.round(BED_GAIN * (1 - DUCK_DEPTH * duck) * 100) / 100;
  if (want !== bedGain) { bedGain = want; audio.mixer.setGain('music', want); }
  bed.set(woke ? 0.42 : 0, woke ? 0.55 : 0.2);
});

boot.onRender((pen) => {
  drawHall(pen, boot.order, look);
});

controlPanel([
  { kind: 'group', label: 'the mixer' }, knobs.voiceCeiling({ value: audio.maxVoices, apply: (v) => { audio.setMaxVoices(v); } }),
  { kind: 'group', label: 'the dark' }, knobs.lightBloom(boot), knobs.lightScale(boot), knobs.lightFalloff(boot),
  { kind: 'group', label: 'pixels' }, knobs.snap(boot), knobs.pixelRatio(boot), knobs.seed(boot),
], { params: boot.params, title: 'Instrument', subtitle: 'Sound with no files.', stats: knobs.cost(boot) });

(globalThis as unknown as { __lattice: object }).__lattice = { loop: boot.loop, order: boot.order, camera: boot.camera, strike, audio, look };
boot.start();
