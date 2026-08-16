import { describe, expect, it } from 'vitest';

import { capacityLoad, capacityShare, capacityWall } from '../src/capacity.js';
import type { CapacityCurve } from '../src/capacity.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

/** The source game's shipping number: production reaches zero at 1.5× over-draw. */
const GRID: CapacityCurve = { blackoutAt: 1.5 };

describe('capacityWall — the constraint the player must fear (I12)', () => {
  it('is exactly 1 at parity, for any supply', () => {
    for (const supply of [1, 20, 136.75, 1e12]) {
      expect(capacityWall(supply, supply, GRID)).toBe(1);
    }
  });

  it('is exactly 0 at the blackout point, for any supply', () => {
    for (const supply of [1, 20, 136.75, 1e12]) {
      expect(capacityWall(supply, supply * GRID.blackoutAt, GRID)).toBe(0);
    }
  });

  it('falls strictly and monotonically between parity and blackout', () => {
    const supply = 20;
    let previous = 1;
    for (let demand = supply; demand <= supply * GRID.blackoutAt; demand += 0.25) {
      const output = capacityWall(supply, demand, GRID);
      expect(output).toBeLessThanOrEqual(previous);
      expect(output).toBeGreaterThanOrEqual(0);
      expect(output).toBeLessThanOrEqual(1);
      if (demand > supply && demand < supply * GRID.blackoutAt) {
        expect(output).toBeLessThan(previous);
      }
      previous = output;
    }
  });

  it('is linear: half way to blackout is half output', () => {
    // supply 20, blackout at 30, so demand 25 is exactly halfway.
    expect(capacityWall(20, 25, GRID)).toBe(0.5);
  });

  it('is a wall and not a tax — seven times over-draw is zero, not a fifth speed (T10)', () => {
    // The bot in the source game sat at 136 MW against 20 MW for forty minutes because the first
    // version clamped the ratio at 0.2. There is deliberately no floor here.
    expect(capacityWall(20, 136, GRID)).toBe(0);
  });

  it('is 0 for no supply against any demand, and 1 for no demand at all', () => {
    expect(capacityWall(0, 1, GRID)).toBe(0);
    expect(capacityWall(-5, 1, GRID)).toBe(0);
    expect(capacityWall(20, 0, GRID)).toBe(1);
    expect(capacityWall(0, 0, GRID)).toBe(1);
    expect(capacityWall(-1, -1, GRID)).toBe(1);
  });

  it('never returns NaN, whatever it is handed', () => {
    for (const supply of [0, 20, Infinity, -Infinity, Number.NaN]) {
      for (const demand of [0, 20, Infinity, -Infinity, Number.NaN]) {
        expect(Number.isNaN(capacityWall(supply, demand, GRID))).toBe(false);
      }
    }
  });

  it('reads a NaN demand as no demand rather than as a blackout', () => {
    // Fail-open, deliberately: a NaN is a bug in the game's own supply/demand sum, and a NaN that
    // blacks out the grid is unrecoverable while one that reads healthy leaves the game playable.
    expect(capacityWall(20, Number.NaN, GRID)).toBe(1);
  });

  it('names a blackout point that is not a wall', () => {
    for (const blackoutAt of [1, 0.5, 0, -1]) {
      expect(messageOf(() => capacityWall(20, 30, { blackoutAt }))).toContain(
        'curve.blackoutAt must be > 1',
      );
    }
    expect(messageOf(() => capacityWall(20, 30, { blackoutAt: Number.NaN }))).toContain(
      'curve.blackoutAt',
    );
    expect(messageOf(() => capacityWall(20, 30, { blackoutAt: Infinity }))).toContain(
      'curve.blackoutAt',
    );
  });
});

describe('capacityShare — the constraint that merely limits (I12)', () => {
  it('is 1 while supply covers demand and `supply / demand` above it', () => {
    expect(capacityShare(20, 10)).toBe(1);
    expect(capacityShare(20, 20)).toBe(1);
    expect(capacityShare(20, 40)).toBe(0.5);
    expect(capacityShare(20, 1e6)).toBe(20 / 1e6);
  });

  it('is never zero for a finite positive supply — a full road queues, it does not destroy', () => {
    // Using the wall where you meant the share makes a full road *destroy* the pilgrims past
    // capacity. This is the property that distinguishes the two.
    for (const demand of [21, 100, 1e6, 1e300]) {
      expect(capacityShare(1e-6, demand)).toBeGreaterThan(0);
    }
    expect(capacityWall(1e-6, 100, GRID)).toBe(0);
  });

  it('is 0 for no supply and 1 for no demand', () => {
    expect(capacityShare(0, 1)).toBe(0);
    expect(capacityShare(-1, 1)).toBe(0);
    expect(capacityShare(20, 0)).toBe(1);
    expect(capacityShare(0, 0)).toBe(1);
  });

  it('never returns NaN', () => {
    for (const supply of [0, 20, Infinity, Number.NaN]) {
      for (const demand of [0, 20, Infinity, Number.NaN]) {
        expect(Number.isNaN(capacityShare(supply, demand))).toBe(false);
      }
    }
  });
});

describe('capacityLoad — the meter', () => {
  it('is demand over supply, so 18 of 20 reads as 0.9 rather than as 6 of 20', () => {
    expect(capacityLoad(20, 18)).toBe(0.9);
    expect(capacityLoad(20, 30)).toBe(1.5);
  });

  it('is 0 for no demand and Infinity for no supply — never NaN', () => {
    expect(capacityLoad(20, 0)).toBe(0);
    expect(capacityLoad(0, 0)).toBe(0);
    expect(capacityLoad(0, 5)).toBe(Infinity);
    expect(capacityLoad(-1, 5)).toBe(Infinity);
    expect(Number.isNaN(capacityLoad(Number.NaN, Number.NaN))).toBe(false);
  });

  it('is the one value in this surface that may be infinite, and it must never be stored (T24)', () => {
    const infinite = capacityLoad(0, 5);
    expect(JSON.stringify({ load: infinite })).toBe('{"load":null}');
  });
});

describe('the two curves are not interchangeable', () => {
  it('differ most exactly where a designer would notice least', () => {
    // At mild over-draw the wall and the share look similar; at real over-draw one of them has
    // stopped the campus and the other is still handing out slices.
    const supply = 20;
    expect(Math.abs(capacityWall(supply, 22, GRID) - capacityShare(supply, 22))).toBeLessThan(0.2);
    expect(capacityWall(supply, 40, GRID)).toBe(0);
    expect(capacityShare(supply, 40)).toBe(0.5);
  });
});
