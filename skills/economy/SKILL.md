---
name: economy
description: Numbers that grow — production, resources, prices, upgrades, capacity, and progress that keeps accruing while the tab is closed. Use for an idle or incremental game, a tycoon, resources or currency, a shop with rising prices, a buy-max button, offline earnings, "it should keep earning while I'm away", or when income is wrong after coming back to the tab.
---

# Economy

The whole package is one idea: **everything is linear between commits.** Gates, milestones,
purchases, nightfall and a stock hitting zero are the discontinuities, and every one of them is a
*boundary* — an instant at which the caller re-enters. That is what makes one integration of
fourteen hours equal to fifty thousand integrations of one second, and it is why offline progress
and live play are the same code path rather than two that drift.

**There is no tick, no clock and no state of its own.** Every call that moves the anchor takes a
required epoch timestamp, so a frame delta has nowhere to go — and a builder who sees `dt` in
`update()` and reaches for it will find no signature to put it in. That refusal is the design.

---

## A whole economy

```ts
import { asEpochMillis } from '@latticekit/core';
import {
  advance, buildFlow, costOfNext, createFlow, defineEconomy,
  elapsedSeconds, maxBuyable, project, zeroStocks,
} from '@latticekit/sim';
import type { CostCurve, Ledger } from '@latticekit/sim';

type Node = 'lamp' | 'coin';
type Gate = 'night';

let reach = 1;                     // a banked total: it changes only when the player acts

const eco = defineEconomy<Node, Gate>({
  // `nodes` is the SAVE'S FIELD ORDER and it never changes. Append in v4 and every v1 save
  // still deserializes with its fields where they were.
  nodes: ['lamp', 'coin'],
  gates: ['night'],
  edges: [
    // A SOURCE — no `from`. This is what an idle game's headline rate usually is: the thing
    // that pays while the player owns zero of everything.
    { to: 'coin', per: 2, gate: 'night' },
    // A plain producer, with a rate that is any expression you like as long as it is
    // piecewise constant in time. `scale` is evaluated ONCE PER buildFlow and frozen.
    { from: 'lamp', to: 'coin', per: 0.5, scale: () => Math.sqrt(reach) },
  ],
});

const flow = createFlow(eco);
const view = zeroStocks(eco);

let ledger: Ledger<Node> = {
  stocks: { lamp: 3, coin: 0 },
  atMs: asEpochMillis(1_700_000_000_000),
};
let dark = false;

/** The game owns the calendar. ONE call site, greppable, and never reaching a tile or a hash. */
const epochNow = (): ReturnType<typeof asEpochMillis> => asEpochMillis(Date.now());

/** In `render` (or in `update` for a HUD): read the economy at an instant. Moves nothing. */
export function read(): number {
  project(eco, ledger, flow, epochNow(), view);
  return view.coin;
}

/** In an action handler: commit what is owed, THEN change the rate. */
function commit(atMs: ReturnType<typeof asEpochMillis>): void {
  ledger = advance(eco, ledger, flow, elapsedSeconds(ledger, atMs), atMs);
}

export function nightfall(nowDark: boolean): void {
  const atMs = epochNow();
  commit(atMs);                                          // a gate is a BOUNDARY, not a curve
  dark = nowDark;
  buildFlow(eco, ledger.stocks, { night: dark ? 1.7 : 1 }, flow);
}

const LAMP: CostCurve = { base: 12, growth: 1.3 };

export function buyLamp(): boolean {
  const atMs = epochNow();
  commit(atMs);
  const price = costOfNext(LAMP, ledger.stocks.lamp);
  if (ledger.stocks.coin < price) return false;          // compare EXACTLY. No epsilon
  ledger = {
    stocks: { lamp: ledger.stocks.lamp + 1, coin: ledger.stocks.coin - price },
    atMs: ledger.atMs,
  };
  reach += 1;
  // `reach` moved and `scale` is sampled once per buildFlow — so this rebuild is not
  // bookkeeping, it is the only thing that makes the new lamp pay.
  buildFlow(eco, ledger.stocks, { night: dark ? 1.7 : 1 }, flow);
  return true;
}

/** The shop's "buy max". Closed form: 4,000 owned costs what 4 owned costs. */
export function affordable(): number {
  return maxBuyable(LAMP, ledger.stocks.lamp, view.coin, 1_000_000);
}
```

**Wire it as: `project` in render, `advance` in the action handler, `advanceOver` at hydrate.**

**An untagged edge is silently never gated.** In one exhibit the night edge had no `gate`, so
the gate ratios were passed to `buildFlow` and never read — the dark paid nothing while the HUD
said `+1.7×` and a toast promised offerings were worth more after dark. Three surfaces agreeing
on a lie, and the fix was one word.

**A gate is binary and committed at the boundary**, never varied continuously, because a rate
that moves inside an integral makes the answer depend on how often you asked.

---

## "Linear" does not mean your rate has to be a straight line

Read this before concluding your square root, threshold or milestone is unsupported. It is not,
and a game built on this kit once wrote a division to work around a restriction that was never
there.

| a real idle-game rate | function of | legal |
|---|---|---|
| every 10th press doubles all presses | a purchased count | yes — `scale: () => milestoneMultiplier(bought, MILESTONES)` |
| output scales with `√(prestige)` | a banked, player-facing total | yes |
| producers above 100 get a 3× bonus | a purchased count | yes — a threshold inside `scale` |
| income scales with how far a road reaches | a length the player extends | yes, and with no `from` it is a source |
| output ∝ `√(coin you currently hold)` | **a stock this graph produces** | **no, and it must stay no** |

The one rate `sim` refuses is one that reads a stock this graph produces, because that is a
discontinuity inside an integral and it makes the same save answer two ways.

**An edge with no `from` is a source.** Written any other way, that headline rate has to nominate
an arbitrary `from` and divide it back out inside `scale`, guard the zero so the division is not
`0/0`, and keep the nominated node in `nodes` — **which is the save's field order.** The
workaround reaches the save file. One exhibit shipped exactly that and its economy dropped from
two nodes to one when `from` became optional.

**Cycles and self-loops are refused at construction, naming the cycle.** There is deliberately no
numerical fallback: it would be a second implementation of the economy with different answers,
and a game would cross the boundary without noticing.

---

## Offline, and the exploit that lives in the obvious way to write it

```ts
import { asEpochMillis } from '@latticekit/core';
import { advanceOver, solveCrossingOver } from '@latticekit/sim';
import type { CatchUp, Economy, Flow, Ledger, OfflineCurve, Phase } from '@latticekit/sim';

export const CURVE: OfflineCurve = {
  uncappedSeconds: 3 * 3600,      // credited in full below this
  exponent: 0.625,                // 5/8. DYADIC — see below
  flatAfterSeconds: 24 * 3600,    // the only clamp there is
};

type Node = 'lamp' | 'coin';
type Gate = 'night';

/** Resolve an absence, stopping at every instant something ran out. */
export function hydrate(
  eco: Economy<Node, Gate>,
  start: Ledger<Node>,
  flow: Flow,
  phases: Phase<Gate>[],       // the game's own day/night schedule, absolute in these coords
  span: number,                // real seconds of the absence
): Ledger<Node> {
  let ledger = start;
  let consumed = 0;            // real seconds of the absence already paid for
  for (;;) {
    const plan: CatchUp<Gate> = { fromSeconds: consumed, spanSeconds: span, phases, curve: CURVE };
    const crossing = solveCrossingOver(eco, ledger, flow, plan, 'coin', 0);
    if (crossing.atSeconds === Infinity) break;
    ledger = advanceOver(
      eco, ledger, flow,
      { ...plan, spanSeconds: crossing.atSeconds },
      asEpochMillis(ledger.atMs + crossing.atSeconds * 1000),
    );
    // …apply the game event that happened here, then rebuild the flow…
    consumed = crossing.atSeconds;   // ← the whole point: RESUME, never restart
  }
  return advanceOver(
    eco, ledger, flow,
    { fromSeconds: consumed, spanSeconds: span, phases, curve: CURVE },
    asEpochMillis(start.atMs + span * 1000),
  );
}
```

**`CatchUp.fromSeconds` is required, not optional**, and the reason is an exploit. The offline
warp `W` is strictly concave, so restarting it pays for *K absences instead of one*, and every
restart begins in the uncapped region again, which makes each one cheaper in real time than the
last:

```ts
import { offlineCredit } from '@latticekit/sim';
import type { OfflineCurve } from '@latticekit/sim';

const c: OfflineCurve = { uncappedSeconds: 3 * 3600, exponent: 0.625, flatAfterSeconds: 24 * 3600 };
const t = 20 * 3600;
export const one = offlineCredit(t, c);            // 35,348 s — one absence
export const two = 2 * offlineCredit(t / 2, c);    // 45,841 s
export const eight = 8 * offlineCredit(t / 8, c);  // 72,000 s — the softcap is gone
```

The credit for one call is `W(spanSeconds) − W(fromSeconds)`, which telescopes across the whole
re-entry sequence to exactly `W(T)`. `Crossing.atSeconds` is in the same coordinates precisely so
it can be handed straight back as the next call's `fromSeconds`. Writing `fromSeconds: 0` is the
deliberate act that says "this is the start of the absence", and a reviewer can grep for it.

**The upper clamp on the gap is the softcap's flat branch, and there is no second cap.**
`offlineCredit` clamps its own *input* at `flatAfterSeconds` before the power, so 24 h, 48 h and
a phone whose clock jumped a year all return the identical number to the bit. At 3 h / 0.625 /
24 h that number is about eleven hours.

**But a gap is capped and an anchor is not.** `advance` still stamps the ledger at the bogus
instant, and when the clock is corrected every subsequent read sees time running backwards and
credits zero — *the economy freezes for a year*, with no error and a save that looks fine.
`reanchor` is the answer: detect a backwards gap larger than a plausible clock correction, keep
the stocks, move the anchor, and be running again on the next frame. That test is two lines and
nobody writes it.

**Pick a dyadic exponent.** `0.5`, `0.625` and `0.75` are computed as a chain of `Math.sqrt` and
multiplies — both exactly specified by the language — so credited time is bit-identical across
engines for free. `0.6` is three per cent stingier than `0.625` and a whole determinism tier
worse.

**`uncappedSeconds` is a design constraint, not just a generosity dial.** If a standing charge
accrues on a cycle, `U` must exceed that cycle's period by a wide margin or the cycle is
skippable: the warp shrinks credited time, which shrinks the *charge* as well as the income, so a
game whose night is a standing charge rewards the player for closing the tab during it. Nothing
is minted, so it is not a dupe — it is an incentive pointing exactly away from the intended play.
And do not fix it by exempting one flow from the warp: that means two ledgers and two anchors,
and it makes the stock non-polynomial so `solveCrossingOver` stops applying. **Move the
punishment from flow into state** — lamps that go out and stay out until tapped — which
`solveCrossing` gives you exactly, and closing the tab is never a win.

At `exponent: 1.0` the curve is the identity and closing the tab becomes optimal play. At
`flatAfterSeconds` set to weeks, a device clock a month fast pays a month.

---

## Accrual reads `ledger.atMs`, never a save's write stamp

The stamp is when the record was *written*; the anchor is when the numbers were last *true*. A
debounced write 30 s after the last `advance` makes them differ by 30 s, and using the stamp pays
that interval twice or steals it — every session, invisibly. To make them agree, `advance`
immediately before handing state to a writer.

---

## Two capacity curves that are not interchangeable

`capacityWall` is `1` at parity and falls **linearly to 0** at `blackoutAt` times over-draw — for
a constraint the player must *fear*. `capacityShare` is `min(1, supply/demand)` — a queue, for a
constraint that merely *limits*.

Using the wall where you meant the share makes a full road **destroy** the traffic past capacity.
Using the share where you meant the wall makes a brownout a tax you can ignore: a bot in the
source game sat at 136 MW of draw against 20 MW of supply for forty minutes, because it could.
There is deliberately no floor on the wall.

Gating is per **edge**, and anything that *supplies* the gated capacity leaves its edges
untagged. Curtailment sheds load; it does not shut down the generator. A player who over-builds
into total darkness must still be able to earn their way back, or the fail state is a dead save
rather than a stake.

---

## What may be persisted, hashed, or compared

| | |
|---|---|
| `integrate`, `ratesOf`, `advance`, `advanceOver`, `project` | exact everywhere. The "matrix exponential" never calls `exp` |
| `costOfNext`, `bulkCost` | exact — integer exponent by squaring, not `Math.pow` |
| `maxBuyable` | **advisory only.** Never store it, checksum it, or put it in a log. At an exact boundary two engines can differ by one unit bought |
| `offlineCredit` | exact for a dyadic exponent, approximate otherwise |

The authoritative purchase check is `bulkCost(curve, owned, n) <= budget`, compared **exactly**.
An epsilon there lets a player buy something they cannot afford.

**Never hash or equality-compare a stock vector**; compare with a relative tolerance of 1e-9. A
save's checksum must cover the bytes read, never a recomputed state.

**`Infinity` is a perfectly valid arithmetic result and is precisely the value that does not
survive being written down** — it serializes to `null`, under a valid checksum, so nothing
downstream can detect it. `advance` and `advanceOver` throw a `RangeError` naming the node rather
than letting one reach a save, and `expectFiniteStocks` is the load-side check. `capacityLoad` is
the one derived read here that may be infinite, and it must never be stored.

**Recompute a price, never store it.** The curve's parameters are the durable thing; a stored
price is a fact about one build.

---

## What this skill does not cover

| you want | read |
|---|---|
| the loop, and where `dt` may and may not go | `starting` |
| showing the numbers, a buy button, a price that greys out | `hud` |
| writing the ledger to disk and migrating it | `saving` |
| replays and cross-engine agreement | `determinism` |
| the world the economy is about | `world` |

Long form, on disk: `node_modules/@latticekit/sim/README.md`.
