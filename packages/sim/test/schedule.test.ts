import { describe, expect, it } from 'vitest';
import { asEpochMillis } from '@lattice/core';
import type { EpochMillis } from '@lattice/core';

import { defineEconomy, zeroStocks } from '../src/graph.js';
import type { Economy } from '../src/graph.js';
import { NO_GATES, buildFlow, createFlow } from '../src/flow.js';
import type { GateRatios } from '../src/flow.js';
import { advance } from '../src/ledger.js';
import type { Ledger } from '../src/ledger.js';
import { offlineCredit } from '../src/offline.js';
import type { OfflineCurve } from '../src/offline.js';
import { advanceOver, solveCrossingOver } from '../src/schedule.js';
import type { CatchUp, Phase } from '../src/schedule.js';

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

const HOUR = 3600;
const BASE = 1_700_000_000_000;

/** A dyadic curve, so every number in this file is Tier A and comparable to the bit. */
const CURVE: OfflineCurve = {
  uncappedSeconds: 3 * HOUR,
  exponent: 0.625,
  flatAfterSeconds: 24 * HOUR,
};

type Node = 'clock' | 'tick' | 'lamp' | 'oil';

/**
 * A stopwatch welded to a lamp.
 *
 * `clock → tick` is untagged and unit-rated, so with `clock = 1` the `tick` stock **is** the total
 * credited seconds this package has integrated — which is the quantity every telescoping assertion
 * in this file is really about. `lamp → oil` is gated on `dark`, so nights burn oil and days do not.
 */
function world(): Economy<Node, 'dark'> {
  return defineEconomy({
    nodes: ['clock', 'tick', 'lamp', 'oil'],
    gates: ['dark'],
    edges: [
      { from: 'clock', to: 'tick', per: 1 },
      { from: 'lamp', to: 'oil', per: -1, gate: 'dark' },
    ],
  });
}

function ledgerAt(oil: number, lamp: number): Ledger<Node> {
  return { stocks: { clock: 1, tick: 0, lamp, oil }, atMs: asEpochMillis(BASE) };
}

function at(seconds: number): EpochMillis {
  return asEpochMillis(BASE + seconds * 1000);
}

const LIT: GateRatios<'dark'> = { dark: 1 };
const DAY: GateRatios<'dark'> = { dark: 0 };

/** One phase at zero, lit throughout: the "nothing changed during the absence" schedule. */
const ONE_PHASE: readonly Phase<'dark'>[] = [{ atSeconds: 0, gates: LIT }];

/** Alternating 45 s days and 60 s nights, out to `until` seconds. */
function dayNight(until: number): Phase<'dark'>[] {
  const phases: Phase<'dark'>[] = [];
  let t = 0;
  let dark = false;
  while (t <= until) {
    phases.push({ atSeconds: t, gates: dark ? LIT : DAY });
    t += dark ? 60 : 45;
    dark = !dark;
  }
  return phases;
}

describe('advanceOver — the warp is applied once (I7)', () => {
  it('is bit-identical to advance with the scalar credit when there is one phase', () => {
    const eco = world();
    const flow = createFlow(eco);
    const start = ledgerAt(1e9, 2);
    const span = 9 * HOUR;

    const viaPlan = advanceOver(
      eco,
      start,
      flow,
      { fromSeconds: 0, spanSeconds: span, phases: ONE_PHASE, curve: CURVE },
      at(span),
    );
    buildFlow(eco, start.stocks, LIT, flow);
    const viaScalar = advance(eco, start, flow, offlineCredit(span, CURVE), at(span));

    expect(viaPlan.stocks).toEqual(viaScalar.stocks);
    expect(viaPlan.stocks.tick).toBe(offlineCredit(span, CURVE));
  });

  it('telescopes across hundreds of phases to exactly the whole-span credit', () => {
    const eco = world();
    const flow = createFlow(eco);
    const span = 20 * HOUR;
    const phases = dayNight(span);
    expect(phases.length).toBeGreaterThan(600);

    const led = advanceOver(
      eco,
      ledgerAt(1e9, 2),
      flow,
      { fromSeconds: 0, spanSeconds: span, phases, curve: CURVE },
      at(span),
    );
    const expected = offlineCredit(span, CURVE);
    // `tick` is the float sum of `W(hᵢ) − W(lᵢ)` over ~680 pieces. Each subtraction is exactly
    // rounded, so the accumulated error is at most 680·2⁻⁵² ≈ 1.5e-13 relative. 1e-12 is the
    // honest ceiling and is still ten orders below the error a restarted warp would produce.
    expect(Math.abs(led.stocks.tick - expected) / expected).toBeLessThan(1e-12);
  });

  it('restarting the warp per phase is the bug, and it is worth catching (T7)', () => {
    // The arithmetic behind the exploit, stated on its own: `W` is strictly concave, so K pieces
    // each credited from zero pay strictly more than one piece of the whole.
    const span = 20 * HOUR;
    const whole = offlineCredit(span, CURVE);
    for (const k of [2, 8, 64]) {
      let restarted = 0;
      for (let i = 0; i < k; i += 1) restarted += offlineCredit(span / k, CURVE);
      expect(restarted).toBeGreaterThan(whole);
    }
    // And it grows with the number of restarts until the softcap has simply gone: once every
    // restarted piece is shorter than the uncapped window, `W` is the identity on all of them and
    // the player is paid the whole absence at the live rate — twenty hours instead of ten.
    const two = 2 * offlineCredit(span / 2, CURVE);
    const eight = 8 * offlineCredit(span / 8, CURVE);
    expect(eight).toBeGreaterThan(two);
    expect(eight).toBe(span);
    expect(span / whole).toBeGreaterThan(1.9);
  });

  it('subdividing a phase changes nothing, because a zero-length piece credits zero (I4)', () => {
    const eco = world();
    const flow = createFlow(eco);
    const start = ledgerAt(1e9, 2);
    const span = 5 * HOUR;
    const plain = advanceOver(
      eco,
      start,
      flow,
      { fromSeconds: 0, spanSeconds: span, phases: [{ atSeconds: 0, gates: LIT }], curve: CURVE },
      at(span),
    );
    // A second phase beginning exactly where the absence ends: the piece clips to nothing.
    const padded = advanceOver(
      eco,
      start,
      flow,
      {
        fromSeconds: 0,
        spanSeconds: span,
        phases: [
          { atSeconds: 0, gates: LIT },
          { atSeconds: span, gates: DAY },
        ],
        curve: CURVE,
      },
      at(span),
    );
    expect(padded.stocks).toEqual(plain.stocks);
  });
});

describe('advanceOver — resuming a partially-consumed absence (fromSeconds)', () => {
  it('credits exactly W(span) − W(from) for one call', () => {
    const eco = world();
    const flow = createFlow(eco);
    const from = 4 * HOUR;
    const span = 11 * HOUR;
    const led = advanceOver(
      eco,
      ledgerAt(1e9, 0),
      flow,
      { fromSeconds: from, spanSeconds: span, phases: ONE_PHASE, curve: CURVE },
      at(span),
    );
    expect(led.stocks.tick).toBe(offlineCredit(span, CURVE) - offlineCredit(from, CURVE));
  });

  it('telescopes across a whole re-entry sequence to exactly W(T), once', () => {
    const eco = world();
    const flow = createFlow(eco);
    const span = 18 * HOUR;
    const cuts = [0, 1 * HOUR, 2.5 * HOUR, 6 * HOUR, 13 * HOUR, span];

    let led = ledgerAt(1e9, 0);
    for (let i = 1; i < cuts.length; i += 1) {
      const from = cuts[i - 1] ?? 0;
      const to = cuts[i] ?? 0;
      led = advanceOver(
        eco,
        led,
        flow,
        { fromSeconds: from, spanSeconds: to, phases: ONE_PHASE, curve: CURVE },
        at(to),
      );
    }
    const whole = offlineCredit(span, CURVE);
    // Five telescoping subtractions of doubles near 4e4: at most 5 ulps ≈ 5e-11 absolute, which is
    // 1e-15 relative. 1e-14 is three orders of margin.
    expect(Math.abs(led.stocks.tick - whole) / whole).toBeLessThan(1e-14);
    expect(led.atMs).toBe(at(span));
  });

  it('re-entering with a fresh span instead pays for K absences — the closed exploit', () => {
    const eco = world();
    const flow = createFlow(eco);
    const span = 18 * HOUR;
    const cuts = [0, 1 * HOUR, 2.5 * HOUR, 6 * HOUR, 13 * HOUR, span];

    // The mistake: each re-entry starts a new absence at zero and asks for the remainder.
    let restarted = ledgerAt(1e9, 0);
    for (let i = 1; i < cuts.length; i += 1) {
      const from = cuts[i - 1] ?? 0;
      const to = cuts[i] ?? 0;
      restarted = advanceOver(
        eco,
        restarted,
        flow,
        { fromSeconds: 0, spanSeconds: to - from, phases: ONE_PHASE, curve: CURVE },
        at(to),
      );
    }
    const whole = offlineCredit(span, CURVE);
    expect(restarted.stocks.tick).toBeGreaterThan(whole);
    // Five commits inside one eighteen-hour absence pay for well over an extra hour of production,
    // and the first four cuts are inside the uncapped window where the error is *invisible*.
    expect(restarted.stocks.tick - whole).toBeGreaterThan(HOUR);
  });

  it('credits nothing and still moves the anchor when the absence is fully consumed', () => {
    const eco = world();
    const flow = createFlow(eco);
    const span = 7 * HOUR;
    const led = advanceOver(
      eco,
      ledgerAt(1e9, 0),
      flow,
      { fromSeconds: span, spanSeconds: span, phases: ONE_PHASE, curve: CURVE },
      at(span),
    );
    expect(led.stocks.tick).toBe(0);
    expect(led.atMs).toBe(at(span));
  });

  it('credits nothing rather than throwing when rounding puts `from` a hair past `span`', () => {
    const eco = world();
    const flow = createFlow(eco);
    const led = advanceOver(
      eco,
      ledgerAt(1e9, 0),
      flow,
      { fromSeconds: 100.0000001, spanSeconds: 100, phases: ONE_PHASE, curve: CURVE },
      at(100),
    );
    expect(led.stocks.tick).toBe(0);
  });

  it('is exactly additive when there is no curve, because W is the identity', () => {
    const eco = world();
    const flow = createFlow(eco);
    const phases = dayNight(600);
    const whole = advanceOver(
      eco,
      ledgerAt(1e9, 3),
      flow,
      { fromSeconds: 0, spanSeconds: 600, phases, curve: null },
      at(600),
    );
    let split = ledgerAt(1e9, 3);
    for (const [from, to] of [
      [0, 137],
      [137, 400],
      [400, 600],
    ] as const) {
      split = advanceOver(eco, split, flow, { fromSeconds: from, spanSeconds: to, phases, curve: null }, at(to));
    }
    expect(split.stocks.tick).toBe(600);
    // Three integrations against one, over a depth-1 graph: the only difference is float addition
    // order, which for these exact values is none at all.
    expect(split.stocks.oil).toBe(whole.stocks.oil);
  });

  it('refuses a negative fromSeconds or spanSeconds', () => {
    const eco = world();
    const flow = createFlow(eco);
    const led = ledgerAt(1, 0);
    expect(
      messageOf(() =>
        advanceOver(eco, led, flow, { fromSeconds: -1, spanSeconds: 10, phases: ONE_PHASE, curve: null }, at(10)),
      ),
    ).toContain('plan.fromSeconds must be >= 0');
    expect(
      messageOf(() =>
        advanceOver(eco, led, flow, { fromSeconds: 0, spanSeconds: -1, phases: ONE_PHASE, curve: null }, at(10)),
      ),
    ).toContain('plan.spanSeconds must be >= 0');
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          led,
          flow,
          { fromSeconds: Number.NaN, spanSeconds: 10, phases: ONE_PHASE, curve: null },
          at(10),
        ),
      ),
    ).toContain('plan.fromSeconds');
    expect(
      messageOf(() =>
        advanceOver(eco, led, flow, { fromSeconds: 0, spanSeconds: Infinity, phases: ONE_PHASE, curve: null }, at(10)),
      ),
    ).toContain('plan.spanSeconds');
  });
});

describe('advanceOver — the horizon bounds reward and work alike (I8, I19)', () => {
  it('returns the identical vector for 24 h, 48 h and a year', () => {
    const eco = world();
    const flow = createFlow(eco);
    const start = ledgerAt(1e12, 2);
    const phases = ONE_PHASE;
    const day = advanceOver(
      eco,
      start,
      flow,
      { fromSeconds: 0, spanSeconds: 24 * HOUR, phases, curve: CURVE },
      at(24 * HOUR),
    );
    for (const span of [48 * HOUR, 365 * 24 * HOUR]) {
      const longer = advanceOver(eco, start, flow, { fromSeconds: 0, spanSeconds: span, phases, curve: CURVE }, at(span));
      expect(longer.stocks).toEqual(day.stocks);
    }
  });

  it('appending phases beyond the horizon changes no stock by a single ulp', () => {
    const eco = world();
    const flow = createFlow(eco);
    const start = ledgerAt(1e12, 2);
    const inside = dayNight(24 * HOUR);
    const beyond = [...inside];
    for (let t = 30 * HOUR; t < 200 * HOUR; t += 97) beyond.push({ atSeconds: t, gates: DAY });

    const plan = { fromSeconds: 0, spanSeconds: 40 * HOUR, curve: CURVE };
    const short = advanceOver(eco, start, flow, { ...plan, phases: inside }, at(40 * HOUR));
    const long = advanceOver(eco, start, flow, { ...plan, phases: beyond }, at(40 * HOUR));
    expect(long.stocks).toEqual(short.stocks);
  });

  it('visits no phase beginning at or after the horizon, out of a hundred thousand', () => {
    const eco = world();
    const flow = createFlow(eco);
    const visited: number[] = [];
    const phases: Phase<'dark'>[] = [];
    for (let i = 0; i < 100_000; i += 1) {
      const start = i * 60;
      phases.push({
        atSeconds: start,
        // A getter, so the phase records the moment `buildFlow` reads its ratio. Reading it is the
        // definition of visiting it: no read, no integration, no cost.
        gates: {
          get dark(): number {
            visited.push(start);
            return 1;
          },
        },
      });
    }
    // A device clock a year fast, handing in a phase list to match.
    advanceOver(
      eco,
      ledgerAt(1e12, 2),
      flow,
      { fromSeconds: 0, spanSeconds: 365 * 24 * HOUR, phases, curve: CURVE },
      at(365 * 24 * HOUR),
    );
    expect(visited.length).toBeGreaterThan(0);
    expect(Math.max(...visited)).toBeLessThan(CURVE.flatAfterSeconds);
    // 24 h of 60 s phases is 1,440 pieces; `buildFlow` reads the ratio once to validate it and once
    // per gated edge, so at most 2 reads each.
    expect(new Set(visited).size).toBeLessThanOrEqual(1440);
  });
});

describe('advanceOver — the plan arrives as data, so it is checked as data', () => {
  it('refuses an empty phase list', () => {
    const eco = world();
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          ledgerAt(1, 0),
          createFlow(eco),
          { fromSeconds: 0, spanSeconds: 10, phases: [], curve: null },
          at(10),
        ),
      ),
    ).toContain('plan.phases');
  });

  it('refuses a first phase that does not begin at zero', () => {
    const eco = world();
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          ledgerAt(1, 0),
          createFlow(eco),
          { fromSeconds: 0, spanSeconds: 10, phases: [{ atSeconds: 5, gates: LIT }], curve: null },
          at(10),
        ),
      ),
    ).toContain('plan.phases[0].atSeconds must be 0');
  });

  it('refuses phases that are not strictly ascending, naming both indices', () => {
    const eco = world();
    const message = messageOf(() =>
      advanceOver(
        eco,
        ledgerAt(1, 0),
        createFlow(eco),
        {
          fromSeconds: 0,
          spanSeconds: 100,
          phases: [
            { atSeconds: 0, gates: LIT },
            { atSeconds: 30, gates: DAY },
            { atSeconds: 30, gates: LIT },
          ],
          curve: null,
        },
        at(100),
      ),
    );
    expect(message).toContain('plan.phases[2].atSeconds (30)');
    expect(message).toContain('plan.phases[1].atSeconds (30)');
  });

  it('refuses a non-finite phase offset', () => {
    const eco = world();
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          ledgerAt(1, 0),
          createFlow(eco),
          {
            fromSeconds: 0,
            spanSeconds: 100,
            phases: [
              { atSeconds: 0, gates: LIT },
              { atSeconds: Number.NaN, gates: LIT },
            ],
            curve: null,
          },
          at(100),
        ),
      ),
    ).toContain('plan.phases[1].atSeconds');
  });

  it('refuses a phase whose gates leave out a declared id', () => {
    const eco = world();
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          ledgerAt(1, 0),
          createFlow(eco),
          {
            fromSeconds: 0,
            spanSeconds: 100,
            phases: [{ atSeconds: 0, gates: {} as GateRatios<'dark'> }],
            curve: null,
          },
          at(100),
        ),
      ),
    ).toContain('sim.buildFlow: gates.dark is undefined');
  });

  it('refuses a result that would not survive a save, naming the node', () => {
    const eco = world();
    const huge: Ledger<Node> = { stocks: { clock: 1e308, tick: 0, lamp: 0, oil: 0 }, atMs: asEpochMillis(BASE) };
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          huge,
          createFlow(eco),
          { fromSeconds: 0, spanSeconds: 1e10, phases: ONE_PHASE, curve: null },
          at(1e10),
        ),
      ),
    ).toContain('sim.advanceOver: stocks.tick is not finite (Infinity)');
  });

  it('refuses a non-finite instant, and returns the ledger unchanged for a backwards one (I19)', () => {
    const eco = world();
    const flow = createFlow(eco);
    const start = ledgerAt(100, 1);
    expect(
      messageOf(() =>
        advanceOver(
          eco,
          start,
          flow,
          { fromSeconds: 0, spanSeconds: 10, phases: ONE_PHASE, curve: null },
          Number.NaN as EpochMillis,
        ),
      ),
    ).toContain('sim.advanceOver: atMs is not finite');
    expect(
      advanceOver(eco, start, flow, { fromSeconds: 0, spanSeconds: 10, phases: ONE_PHASE, curve: null }, at(-1)),
    ).toBe(start);
  });
});

describe('solveCrossingOver — both clocks (I11)', () => {
  it('reports a crossing in real time and in credited time, and the phase it fell in', () => {
    const eco = world();
    const flow = createFlow(eco);
    const start = ledgerAt(600, 2);
    const phases: Phase<'dark'>[] = [
      { atSeconds: 0, gates: DAY },
      { atSeconds: 45, gates: LIT },
    ];
    const plan: CatchUp<'dark'> = { fromSeconds: 0, spanSeconds: 100_000, phases, curve: CURVE };
    const crossing = solveCrossingOver(eco, start, flow, plan, 'oil', 0);

    // 600 oil, two lamps, burning only after nightfall at 45 s: 300 s of burn, so 345 s in.
    // Everything is inside the uncapped window, so the two clocks agree exactly.
    expect(crossing.atSeconds).toBe(345);
    expect(crossing.creditedSeconds).toBe(345);
    expect(crossing.phase).toBe(1);
    expect(offlineCredit(crossing.atSeconds, CURVE)).toBe(crossing.creditedSeconds);
  });

  it('separates the two clocks once the warp bites, and they still agree through W', () => {
    const eco = world();
    const flow = createFlow(eco);
    // Enough oil that the lamps only gutter deep into the softcapped region.
    const start = ledgerAt(20_000, 1);
    const phases: Phase<'dark'>[] = [{ atSeconds: 0, gates: LIT }];
    const plan: CatchUp<'dark'> = { fromSeconds: 0, spanSeconds: 24 * HOUR, phases, curve: CURVE };
    const crossing = solveCrossingOver(eco, start, flow, plan, 'oil', 0);

    expect(crossing.creditedSeconds).toBe(20_000);
    // The player was away *longer* than the physics ran: real time exceeds credited time past the
    // knot. A toast built from the credited number would be confidently wrong about their evening.
    expect(crossing.atSeconds).toBeGreaterThan(crossing.creditedSeconds);
    // 1e-9 relative: two `pow`s in opposite directions over values near 3e4.
    expect(
      Math.abs(offlineCredit(crossing.atSeconds, CURVE) - crossing.creditedSeconds) /
        crossing.creditedSeconds,
    ).toBeLessThan(1e-9);
  });

  it('reports no crossing as Infinity and phase -1', () => {
    const eco = world();
    const flow = createFlow(eco);
    const crossing = solveCrossingOver(
      eco,
      ledgerAt(1e9, 1),
      flow,
      { fromSeconds: 0, spanSeconds: 600, phases: dayNight(600), curve: null },
      'oil',
      0,
    );
    expect(crossing.atSeconds).toBe(Infinity);
    expect(crossing.creditedSeconds).toBe(Infinity);
    expect(crossing.phase).toBe(-1);
  });

  it('reports zero when the stock is already at the level', () => {
    const eco = world();
    const flow = createFlow(eco);
    const crossing = solveCrossingOver(
      eco,
      ledgerAt(0, 1),
      flow,
      { fromSeconds: 0, spanSeconds: 600, phases: [{ atSeconds: 0, gates: LIT }], curve: null },
      'oil',
      0,
    );
    expect(crossing.atSeconds).toBe(0);
    expect(crossing.phase).toBe(0);
  });

  it('resumes from `fromSeconds`, so the second lamp is found after the first', () => {
    const eco = world();
    const flow = createFlow(eco);
    const phases: Phase<'dark'>[] = [{ atSeconds: 0, gates: LIT }];
    const start = ledgerAt(300, 1);
    const first = solveCrossingOver(
      eco,
      start,
      flow,
      { fromSeconds: 0, spanSeconds: 10_000, phases, curve: null },
      'oil',
      0,
    );
    expect(first.atSeconds).toBe(300);
    // Advance to it, refill, and re-enter from where the crossing left off.
    const committed = advanceOver(
      eco,
      start,
      flow,
      { fromSeconds: 0, spanSeconds: first.atSeconds, phases, curve: null },
      at(first.atSeconds),
    );
    const refilled: Ledger<Node> = {
      stocks: { ...committed.stocks, oil: 120 },
      atMs: committed.atMs,
    };
    const second = solveCrossingOver(
      eco,
      refilled,
      flow,
      { fromSeconds: first.atSeconds, spanSeconds: 10_000, phases, curve: null },
      'oil',
      0,
    );
    // 120 more oil at one per second, measured from the start of the absence: 420 s in.
    expect(second.atSeconds).toBe(420);
  });
});

describe('the offline guttering loop, end to end', () => {
  it('pays for one absence however many lamps went out inside it', () => {
    const eco = world();
    const flow = createFlow(eco);
    const span = 16 * HOUR;
    const phases = dayNight(24 * HOUR);
    let led = ledgerAt(400, 4);
    let consumed = 0;
    const gutteredAt: number[] = [];

    for (let guard = 0; guard < 20; guard += 1) {
      const plan: CatchUp<'dark'> = { fromSeconds: consumed, spanSeconds: span, phases, curve: CURVE };
      const crossing = solveCrossingOver(eco, led, flow, plan, 'oil', 0);
      if (crossing.atSeconds === Infinity) break;
      led = advanceOver(
        eco,
        led,
        flow,
        { fromSeconds: consumed, spanSeconds: crossing.atSeconds, phases, curve: CURVE },
        at(crossing.atSeconds),
      );
      // A game action, at an instant: the top lamp goes out and the rest share what is left.
      led = { stocks: { ...led.stocks, lamp: led.stocks.lamp - 1, oil: 400 }, atMs: led.atMs };
      gutteredAt.push(crossing.atSeconds);
      consumed = crossing.atSeconds;
    }
    led = advanceOver(
      eco,
      led,
      flow,
      { fromSeconds: consumed, spanSeconds: span, phases, curve: CURVE },
      at(span),
    );

    expect(gutteredAt).toHaveLength(4);
    expect(led.stocks.lamp).toBe(0);
    // The whole point: four commits inside one absence, and the credited time is still exactly one
    // application of `W` over the whole span. Six telescoping subtractions of values near 4e4 is at
    // most 6 ulps, i.e. 1e-15 relative; 1e-12 is three orders of margin.
    const whole = offlineCredit(span, CURVE);
    expect(Math.abs(led.stocks.tick - whole) / whole).toBeLessThan(1e-12);
    expect(led.atMs).toBe(at(span));
  });

  it('is the same walk in both functions, so the crossing is the instant advanceOver integrates to', () => {
    const eco = world();
    const flow = createFlow(eco);
    const phases = dayNight(24 * HOUR);
    const plan: CatchUp<'dark'> = { fromSeconds: 0, spanSeconds: 12 * HOUR, phases, curve: CURVE };
    const start = ledgerAt(400, 3);
    const crossing = solveCrossingOver(eco, start, flow, plan, 'oil', 0);
    const led = advanceOver(eco, start, flow, { ...plan, spanSeconds: crossing.atSeconds }, at(crossing.atSeconds));
    // Oil is a degree-1 trajectory here, integrated over a few hundred pieces; the residual is the
    // accumulated rounding of the credited durations, bounded by 400 ulps of 400 ≈ 4e-11.
    expect(Math.abs(led.stocks.oil)).toBeLessThan(1e-9);
  });
});

describe('advanceOver — an economy without gates', () => {
  it('takes NO_GATES phases', () => {
    const eco = defineEconomy({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', per: 1 }] });
    const flow = createFlow(eco);
    const led = advanceOver(
      eco,
      { stocks: { a: 1, b: 0 }, atMs: asEpochMillis(BASE) },
      flow,
      { fromSeconds: 0, spanSeconds: 100, phases: [{ atSeconds: 0, gates: NO_GATES }], curve: null },
      at(100),
    );
    expect(led.stocks).toEqual({ a: 1, b: 100 });
    expect(zeroStocks(eco)).toEqual({ a: 0, b: 0 });
  });
});

describe('the schedule walk with a source edge', () => {
  /**
   * The same stopwatch as `world()`, with the clock spelled as a **source** rather than as a node
   * held at 1. `tick` is still the total credited seconds; there is just no `clock` in the save.
   */
  function sourcedWorld(): Economy<'tick' | 'lamp' | 'oil', 'dark'> {
    return defineEconomy({
      nodes: ['tick', 'lamp', 'oil'],
      gates: ['dark'],
      edges: [
        { to: 'tick', per: 1 },
        { from: 'lamp', to: 'oil', per: -1, gate: 'dark' },
      ],
    });
  }

  it('credits a source exactly as it credits a node pinned to one', () => {
    // The equivalence that makes the optional safe, carried all the way through the phase walk,
    // the warp and the re-anchoring: two spellings of the same term, agreeing to the bit.
    const withNode = world();
    const withSource = sourcedWorld();
    const nodeFlow = createFlow(withNode);
    const sourceFlow = createFlow(withSource);
    const phases = dayNight(24 * HOUR);
    const plan: CatchUp<'dark'> = {
      fromSeconds: 0,
      spanSeconds: 9 * HOUR,
      phases,
      curve: CURVE,
    };
    const a = advanceOver(withNode, ledgerAt(1e6, 3), nodeFlow, plan, at(9 * HOUR));
    const b = advanceOver(
      withSource,
      { stocks: { tick: 0, lamp: 3, oil: 1e6 }, atMs: asEpochMillis(BASE) },
      sourceFlow,
      plan,
      at(9 * HOUR),
    );
    expect(b.stocks.tick).toBe(a.stocks.tick);
    expect(b.stocks.oil).toBe(a.stocks.oil);
    // And the save is one field shorter, which is the entire point of the field being optional.
    expect(Object.keys(b.stocks)).toEqual(['tick', 'lamp', 'oil']);
  });

  it('finds a crossing on a stock a source feeds (T5)', () => {
    // `tick` climbs at 1/s from nothing but the source, so the instant it reaches 500 is the
    // instant 500 credited seconds have passed — a fact the walk has to agree with, and one that
    // only exists at all if the source survived into `solveCrossingOver`'s coefficients.
    const eco = sourcedWorld();
    const flow = createFlow(eco);
    const start: Ledger<'tick' | 'lamp' | 'oil'> = {
      stocks: { tick: 0, lamp: 1, oil: 1e6 },
      atMs: asEpochMillis(BASE),
    };
    const plan: CatchUp<'dark'> = {
      fromSeconds: 0,
      spanSeconds: 2 * HOUR,
      phases: [{ atSeconds: 0, gates: LIT }],
      curve: CURVE,
    };
    const crossing = solveCrossingOver(eco, start, flow, plan, 'tick', 500);
    // Inside the uncapped window, so real and credited seconds are the same number.
    expect(crossing.creditedSeconds).toBe(500);
    expect(crossing.atSeconds).toBe(500);
    const led = advanceOver(eco, start, flow, { ...plan, spanSeconds: crossing.atSeconds }, at(500));
    expect(led.stocks.tick).toBe(500);
  });
});
