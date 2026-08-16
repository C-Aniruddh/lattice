/**
 * Gating as a first-class primitive.
 *
 * Power supply multiplies every producer, so the fourth server rack browns out the whole campus at
 * once. That single mechanic is what turns an idle curve into a game — it is the first moment the
 * player's own success is the thing hurting them — and no idle library has it as a primitive.
 *
 * **There are two curves here and they are not interchangeable.** Choosing wrongly is the most
 * consequential balance mistake this package can be an accessory to:
 *
 * | | shape | for |
 * |---|---|---|
 * | {@link capacityWall} | `1` at parity, falling linearly to `0` at `blackoutAt` | a constraint the player must **fear**: power, wicks, anything whose breach is an event |
 * | {@link capacityShare} | `min(1, supply/demand)` | a constraint that merely **limits**: a road that holds only so many pilgrims, a market that absorbs only so much |
 *
 * Using the wall where you meant the share makes a full road *destroy* the pilgrims past capacity.
 * Using the share where you meant the wall makes a brownout a tax you can ignore for forty
 * minutes — a bot in the source game did exactly that, sitting at 136 MW of draw against 20 MW of
 * supply and running at a fifth speed indefinitely, because it could.
 *
 * **Where supply and demand come from is the game's business, and that is the design.** `sim`
 * cannot know that a building under construction supplies nothing and draws nothing — and it must
 * not: a substation that browns out the campus for the forty-five seconds before it helps reads as
 * a bug no matter how defensible the simulation is. The game computes two numbers per frame and
 * hands in a ratio.
 *
 * Two things to check before filing a brownout as a bug in this file:
 *
 * 1. **Are unfinished buildings in the demand sum?** That is trap 12 and it is almost always this.
 * 2. **Are the supply-side edges untagged?** Curtailment sheds load; it does not shut down the
 *    generator. If the edges that *produce* the gated capacity are throttled by it, a total
 *    blackout is unrecoverable and the save is dead. A fail state you cannot dig out of is not a
 *    stake, it is a dead save.
 *
 * Isomorphic and Tier A throughout: comparison, multiplication, division.
 */

import { expectFinite } from '@lattice/core';

/** The wall's one parameter. */
export interface CapacityCurve {
  /**
   * Demand ÷ supply at which output reaches zero. Must be > 1. The source game ships 1.5.
   *
   * **A brownout is a wall, not a tax.** The first version of this clamped the ratio at 0.2, which
   * meant a player could sit at seven times over-draw indefinitely, running at a fifth speed and
   * simply ignoring it. A constraint you can shrug off is not a constraint, so there is
   * deliberately no `floor` here and no way to add one.
   */
  readonly blackoutAt: number;
}

/**
 * The wall: `1` at or under parity, falling **linearly to `0`** at `blackoutAt` times over-draw.
 *
 * Written against `supply · blackoutAt` rather than against `demand / supply` so that both
 * endpoints are exact: parity returns exactly `1` and the blackout point returns exactly `0`, with
 * no rounding sliver of production left on at the moment the game is telling the player the lights
 * went out.
 *
 * `supply <= 0` with any demand is `0`. `demand <= 0` is `1`. A `NaN` demand — which is a bug in
 * the game's own supply/demand sum — reads as *no demand* rather than as a blackout: a `NaN` that
 * blacks out the grid is unrecoverable, and one that reads as healthy leaves the game playable
 * while the real bug is found. Never returns `NaN`.
 *
 * @throws RangeError if `blackoutAt` is not finite or is not > 1 — at exactly 1 the curve is a
 *   step from full production to nothing with no interval to see it happen in.
 */
export function capacityWall(supply: number, demand: number, curve: CapacityCurve): number {
  expectFinite(curve.blackoutAt, 'sim.capacityWall: curve.blackoutAt');
  if (!(curve.blackoutAt > 1)) {
    throw new RangeError(
      `sim.capacityWall: curve.blackoutAt must be > 1, got ${String(curve.blackoutAt)} — at 1 the wall is a step with no brownout to see, and below 1 it is zero before parity`,
    );
  }
  if (!(demand > 0)) return 1;
  if (!(supply > 0)) return 0;
  if (demand <= supply) return 1;
  const blackout = supply * curve.blackoutAt;
  if (demand >= blackout) return 0;
  return (blackout - demand) / (blackout - supply);
}

/**
 * The share: `min(1, supply / demand)`. A queue, not a wall — everyone present gets a slice and
 * nothing collapses.
 *
 * `demand <= 0` is `1` and `supply <= 0` is `0`; for any finite positive supply the result is
 * strictly positive, which is the property that distinguishes a queue from a wall. Never returns
 * `NaN`.
 */
export function capacityShare(supply: number, demand: number): number {
  if (!(demand > 0)) return 1;
  if (!(supply > 0)) return 0;
  if (demand <= supply) return 1;
  return supply / demand;
}

/**
 * `demand / supply`, for the meter — the number a HUD paints amber at 0.8, so that 18 of 20 does
 * not look like 6 of 20.
 *
 * `0` when demand is zero, `Infinity` when supply is zero and demand is not; never `NaN`, because
 * a `NaN` reaches the player as an empty progress bar rather than as an error anyone can act on.
 *
 * **This is a derived read and it must never be stored.** `Infinity` serialises to `null` with a
 * perfectly valid checksum, and a game that writes this number into its save has put a hole in it
 * that no layer downstream can detect. It is the one value in this package's surface that is
 * deliberately allowed to be infinite.
 */
export function capacityLoad(supply: number, demand: number): number {
  if (!(demand > 0)) return 0;
  if (!(supply > 0)) return Infinity;
  return demand / supply;
}
