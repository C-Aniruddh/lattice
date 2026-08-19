/**
 * The hall as a function of `(seed, gx, gy)`.
 *
 * Logic, because a tap reads the same functions the picture does. Scatter is closed-form —
 * never a list — so a pipe that is off-screen costs nothing, and the same seed is the same
 * hall on every machine.
 */
import { hash2, toUnit } from '@latticekit/core';
import { LEVEL_H } from '@latticekit/draw';
import type { Wave } from '@latticekit/audio';

export const W = 160, H = 160, MAX_LEVELS = 7, MAX_HEIGHT_PX = LEVEL_H * MAX_LEVELS;
export const WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'noise'] as const;
export const STEPS = 12;
const PREFIX: Record<(typeof WAVES)[number], string> = { sine: 'si', triangle: 'tr', square: 'sq', sawtooth: 'sw', noise: 'nz' };

/** About half the tiles carry a pipe — hundreds in any opening frame, thousands on the map. */
export function hasPipe(seed: number, gx: number, gy: number): boolean {
  return gx >= 0 && gy >= 0 && gx < W && gy < H && toUnit(hash2(seed, gx, gy)) > 0.46;
}

/** The five families stripe the hall every sixteen tiles of `gx + gy`, so an opening frame shows three. */
export function waveAt(gx: number, gy: number): Wave {
  return WAVES[((gx + gy) / 16 | 0) % WAVES.length] ?? 'sine';
}

export const stepAt = (seed: number, gx: number, gy: number): number => hash2(seed ^ 0x51e9, gx, gy) % STEPS;
export const pipeH = (seed: number, gx: number, gy: number): number => 1.55 + toUnit(hash2(seed ^ 0xa11, gx, gy)) * 4.8;
export const soundId = (wave: Wave, step: number): string => `${PREFIX[wave]}${String(step)}`;
