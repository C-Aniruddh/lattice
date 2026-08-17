/**
 * The whole of the economy: **one stock**, one gate, one cost curve, and a clock.
 *
 * `night` is the gate the dark closes, and it is binary and committed at the boundary rather than
 * varying continuously, because a rate that moves inside an integral makes the answer depend on
 * how often you asked.
 *
 * There was a second node here, `lit`, and it existed for one reason: `EdgeSpec.from` was required,
 * so a rate that multiplies nothing had to nominate an arbitrary multiplicand and divide it back
 * out — with a `> 0` guard so the division was not `0/0`. `from` is optional now, the edge is a
 * source, and the division and its guard are gone. That was never only tidiness: `EconomySpec.nodes`
 * **is** the save's field order, so the workaround put a field in every save file whose only job
 * was to be multiplied by and then divided by.
 */
import { clamp01, smooth } from '@latticekit/core';
import {
  capacityShare,
  costOfNext,
  createFlow,
  defineEconomy,
  type CostCurve,
  type Economy,
  type Flow,
  type GateRatios,
} from '@latticekit/sim';
import { SPACING } from './valley.js';

export type Node = 'coin';
export type Gate = 'night';

export const LAMP: CostCurve = { base: 12, growth: 1.3 };
/** Seconds of day, of night, and of the ramp between them. One cycle is the sum plus a ramp. */
export const DAY_SEC = 40;
export const NIGHT_SEC = 26;
export const RAMP_SEC = 7;
export const PERIOD = DAY_SEC + NIGHT_SEC + RAMP_SEC;
const COIN_K = 0.09;
const PILGRIM_SPACING = 165;
const LIGHT: GateRatios<Gate> = { night: 1 };
const DARK: GateRatios<Gate> = { night: 1.7 };

/** What the road currently is. One object, mutated in place; the economy reads it through a scale. */
export interface Reach {
  /** Leading run of lit stations from the gate. Pilgrims will not walk past a dark one. */
  run: number;
}

export interface Rules {
  readonly eco: Economy<Node, Gate>;
  readonly flow: Flow;
}

/** How many pilgrims are on the road: word spreads with every lamp, and the road holds only so many. */
export function pilgrims(reach: Reach): number {
  const want = 1 + reach.run;
  const holds = 2 + Math.floor((reach.run * SPACING) / PILGRIM_SPACING);
  return want * capacityShare(holds, want);
}

/** Coin per second before the night bonus: how many walked, and how far they got. */
export function coinRate(reach: Reach): number {
  const px = reach.run * SPACING;
  return px <= 0 ? 0 : pilgrims(reach) * COIN_K * Math.sqrt(px);
}

export function createRules(reach: Reach): Rules {
  const eco = defineEconomy<Node, Gate>({
    nodes: ['coin'],
    gates: ['night'],
    // A source: the road's income is a property of the *world* — how far the light reaches — and
    // multiplies no stock at all. `gate: 'night'` is what makes the dark actually pay: without the
    // tag the edge is untagged, `DARK` is never read, and the HUD's "+1.7×" is a number the
    // economy does not owe.
    edges: [{ to: 'coin', per: 1, gate: 'night', scale: () => coinRate(reach) }],
  });
  return { eco, flow: createFlow(eco) };
}

export const gates = (dark: boolean): GateRatios<Gate> => (dark ? DARK : LIGHT);

/**
 * 1 in full day, 0 at the bottom of the night, smooth across both boundaries.
 *
 * The same number drives the palette lerp, the light field's darkness and the ambience bed's tone,
 * so color and sound cannot drift apart. It is deliberately 1 at `t = 0`: the first frame a player
 * ever sees is the least legible one you will ever draw if you open in the dark.
 */
export function daylightAt(t: number): number {
  const p = ((t % PERIOD) + PERIOD) % PERIOD;
  const up = smooth(clamp01((p - DAY_SEC) / RAMP_SEC));
  const down = smooth(clamp01((p - (PERIOD - RAMP_SEC)) / RAMP_SEC));
  return 1 - up * (1 - down);
}

/** Where the sun or moon sits on its arc, 0 at one horizon and 1 at the other. */
export function cycleAt(t: number): number {
  const p = ((t % PERIOD) + PERIOD) % PERIOD;
  return p < DAY_SEC + RAMP_SEC * 0.5 ? p / (DAY_SEC + RAMP_SEC * 0.5) : (p - DAY_SEC - RAMP_SEC * 0.5) / (PERIOD - DAY_SEC - RAMP_SEC * 0.5);
}

/** The first lamp is free: at second four the player has nothing, and a price is not a tutorial. */
export const lampCost = (built: number): number => (built === 0 ? 0 : costOfNext(LAMP, built - 1));
