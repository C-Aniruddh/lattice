/**
 * Amber dusk over brick — the hour a foundry is most itself.
 *
 * @art
 *
 * Delete this file and the valley still produces, still costs, still resolves fourteen hours
 * in one step. It would just do it in the kit's noon greens. One stop set, hoisted: there is
 * no day cycle here (that is Island's idea) so `lerp` never runs and every ramp key stays put.
 */
import { extendStops, hex, type Stops } from '@latticekit/draw';

const BASE: Stops = Object.freeze({
  sky: hex('#e39a52'),
  ground: hex('#6a4330'),
  ink: hex('#140c08'),
  brand: hex('#c45c32'),
  metal: hex('#4e4a48'),
  glass: hex('#d5c4a4'),
  warn: hex('#ffb44a'),
  ok: hex('#3f8a58'),
  bad: hex('#d24a3a'),
  night: hex('#0b0705'),
});

/** Brick, copper, coal, ash — the four colors a kiln valley has that the kit's ten do not. */
export const DUSK: Stops = extendStops(BASE, {
  brick: hex('#8a4030'),
  copper: hex('#c87a3a'),
  coal: hex('#2a221c'),
  ash: hex('#c8b8a4'),
  scrub: hex('#3a4630'),
});

/** Eight brightness steps. Nobody resolves more on an eight-pixel ember. */
export function snap(x: number): number {
  return Math.round(x * 8) / 8;
}
