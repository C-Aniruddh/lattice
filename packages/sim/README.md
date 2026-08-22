# @latticekit/sim

> Idle-economy mathematics in closed form: cost curves, the flow integrator, offline accrual,
> capacity gating, and the instant a stock runs out.

Part of **[Lattice](https://github.com/plausibleventures/lattice)** — the grid underneath.

```bash
npm i @latticekit/sim
```

**`sim` is the arithmetic of an idle economy in closed form — a production graph you can integrate
in one step, a cost curve you can invert, an offline warp on time, capacity gating, and the instant
a stock runs out — with no tick, no clock and no state of its own.**

The unifying rule, which everything else is a consequence of:

> **Everything in `sim` is linear between commits.** Gates, milestones, purchases, nightfall and a
> stock hitting zero are the discontinuities, and every one of them is a *boundary* — an instant at
> which the caller re-enters. That is what makes one integration of fourteen hours equal to fifty
> thousand integrations of one second.

A boundary is not a tick. A tick's cost scales with elapsed time; a boundary's cost scales with
**how many interesting things happened**, and this package's job is to find those instants exactly
rather than to walk past them at 60 Hz hoping to notice.

### "Linear" does not mean your rate has to be a straight line

Read this before concluding your square root, threshold or milestone is unsupported. It is not,
and a game built on this kit once wrote a division to work around a restriction that was never
there.

> **A rate may be any expression you like — `√`, thresholds, milestones, capacity shares, a curve
> read off a design spreadsheet — as long as it is *piecewise constant in time*.** `EdgeScale` is
> where those expressions go, and it is the sanctioned way to write them rather than an escape
> hatch: it is evaluated **once per `buildFlow`** and frozen for the integration that follows, so
> rebuild at every boundary. The one rate `sim` refuses is one that reads a **stock this graph
> produces**, because that is a discontinuity inside an integral and it makes the same save answer
> two ways.

What matters is what the rate is a function *of*, never what shape it has:

| a real idle-game rate | function of | legal |
|---|---|---|
| every 10th press doubles all presses | a purchased count | yes — `scale: () => milestoneMultiplier(bought, MILESTONES)` |
| output scales with `√(prestige)` | a banked, player-facing total | yes — `scale: () => Math.sqrt(prestige)` |
| producers above 100 get a 3× bonus | a purchased count | yes — a threshold inside `scale` |
| income scales with how far the road reaches | a length the player extends by tapping | yes — and with no `from`, it is a **source** |
| output ∝ `√(coin you currently hold)` | **a stock this graph produces** | **no, and it must stay no** |

And a rate may multiply **nothing at all**. An edge with no `from` is a *source* —
`d(to)/dt += per × scale × gate` — which is what an idle economy's headline rate usually is: the
tick income, the base drip, the thing that pays while the player owns zero of everything.

```ts
edges: [
  { to: 'coin', per: 1, gate: 'night', scale: () => coinRate(reach) },  // ← no `from`
  { from: 'lamp', to: 'coin', per: 0.5 },                               // a plain producer
]
```

Written any other way, that first line has to nominate an arbitrary `from` and divide it back out
inside `scale`, guard the zero so the division is not `0/0`, and keep the nominated node in
`nodes` — **which is the save's field order**. The workaround reaches the save file. That is why
`from` is optional.

A source costs the closed form nothing. It is an affine term, and an affine term is the same
object as a node pinned to `1`: nothing produces that node, so it sorts first, the matrix stays
strictly triangular and nilpotent, and the polynomial still terminates — one degree later along a
source-fed chain, which `Economy.depth` counts for you.

---

## An evening in a lamplighter's economy

Presses make coin all day. Lamps burn oil, but only after dark. The player closes the tab for nine
hours, and while they are away lamps run dry one after another — and the game wants to tell them
*when*, in the clock they actually lived through.

```ts
import { asEpochMillis } from '@latticekit/core';
import {
  advanceOver, buildFlow, costOfNext, createFlow, defineEconomy,
  maxBuyable, offlineCredit, project, solveCrossingOver, zeroStocks,
} from '@latticekit/sim';
import type { CatchUp, Ledger, OfflineCurve, Phase } from '@latticekit/sim';

// ── declare the economy once, at load ───────────────────────────────────────
const prestige = 9;                          // a banked total. changes only when the player acts
const eco = defineEconomy({
  nodes: ['press', 'coin', 'lamp', 'oil'],   // storage order: a save's field order
  gates: ['dark'],
  edges: [
    { to: 'coin', per: 2, gate: 'dark' },                 // a SOURCE: pilgrims tip after dark
    { from: 'press', to: 'coin', per: 0.5,                // a √ rate, and entirely legal
      scale: () => Math.sqrt(prestige) },
    { from: 'lamp', to: 'oil', per: -1, gate: 'dark' },   // lamps burn oil, only at night
  ],
});
console.log('evaluation order:', eco.order.join(' → '), '| depth', eco.depth);

const flow = createFlow(eco);
const view = zeroStocks(eco);

// ── read the economy at an instant. this is what a HUD does, every frame ────
const save: Ledger<'press' | 'coin' | 'lamp' | 'oil'> = {
  stocks: { press: 8, coin: 0, lamp: 3, oil: 900 },
  atMs: asEpochMillis(1_700_000_000_000),
};
buildFlow(eco, save.stocks, { dark: 1 }, flow);
project(eco, save, flow, asEpochMillis(1_700_000_060_000), view);
console.log('after 60 s of night:', 'coin', view.coin, '| oil', view.oil);

// ── the shop button. closed form, so 4,000 owned costs what 4 owned costs ───
console.log('next press costs', costOfNext({ base: 10, growth: 1.07 }, 8).toFixed(2));
console.log('buy max with 5,000 coin:', maxBuyable({ base: 10, growth: 1.07 }, 8, 5_000, 1_000_000));

// ── the player closes the tab for nine hours ────────────────────────────────
const curve: OfflineCurve = {
  uncappedSeconds: 3 * 3600, exponent: 0.625, flatAfterSeconds: 24 * 3600,
};
const span = 9 * 3600;
const phases: Phase<'dark'>[] = [];                       // the game's day/night clock, ~8 lines
for (let t = 0, dark = false; t <= 24 * 3600; dark = !dark) {
  phases.push({ atSeconds: t, gates: { dark: dark ? 1 : 0 } });
  t += dark ? 60 : 45;
}
console.log('nine hours away credits', (offlineCredit(span, curve) / 3600).toFixed(2), 'hours');

// ── resolve the absence, stopping at every lamp that gutters ────────────────
let led = save;
let consumed = 0;                          // real seconds of the absence already paid for
for (;;) {
  const plan: CatchUp<'dark'> = { fromSeconds: consumed, spanSeconds: span, phases, curve };
  const crossing = solveCrossingOver(eco, led, flow, plan, 'oil', 0);
  if (crossing.atSeconds === Infinity) break;
  led = advanceOver(eco, led, flow, { ...plan, spanSeconds: crossing.atSeconds },
                    asEpochMillis(save.atMs + crossing.atSeconds * 1000));
  console.log(`  a lamp guttered ${Math.round(crossing.atSeconds)} s in (real), ` +
              `${Math.round(crossing.creditedSeconds)} s credited, during phase ${crossing.phase}`);
  led = { stocks: { ...led.stocks, lamp: led.stocks.lamp - 1, oil: 12_000 }, atMs: led.atMs };
  consumed = crossing.atSeconds;           // ← the whole point: resume, never restart
}
led = advanceOver(eco, led, flow, { fromSeconds: consumed, spanSeconds: span, phases, curve },
                  asEpochMillis(save.atMs + span * 1000));

console.log('welcome back:', 'coin', led.stocks.coin.toFixed(0),
            '| lamps', led.stocks.lamp, '| oil', led.stocks.oil.toFixed(0));
```

```
evaluation order: press → coin → lamp → oil | depth 1
after 60 s of night: coin 840 | oil 720
next press costs 17.18
buy max with 5,000 coin: 45
nine hours away credits 5.96 hours
  a lamp guttered 525 s in (real), 525 s credited, during phase 9
  a lamp guttered 11197 s in (real), 11047 s credited, during phase 213
welcome back: coin 282016 | lamps 1 | oil 6050
```

Five things to notice in that output.

- **The evaluation order was computed, not declared.** `nodes` is the order a *save* writes its
  fields in, and it never changes; the order the integrator uses comes from Kahn's algorithm over
  the edges. Append a node in v4 and every v1 save still deserialises with its fields where they
  were.
- **840 coin in that first minute is `8 × 0.5 × √9 × 60` plus `2 × 60`** — a square root and a
  source, both in closed form, in a graph that is still depth 1. Neither one is a special case and
  neither one costs an integration step. The save has four fields, which is the four nodes: the
  source's multiplicand is a workspace slot, not a stock.
- **Nine hours credited 5.96.** That is the softcap, applied to *time* rather than to yield — so
  every edge in the graph sees the same shortened interval and there is no way to return with more
  of a downstream resource than the producers could have made.
- **The second lamp guttered at 11,197 s real and 11,047 s credited.** Past the three-hour knot the
  two clocks come apart, and they keep coming apart. A toast built from the credited number would be
  confidently wrong about the player's own evening; `Crossing` carries both so neither has to be
  derived at the call site.
- **Two commits happened inside one absence, and the player was paid for one absence.** That is
  `fromSeconds`, and it is the next section.

---

## `fromSeconds`, and the exploit it closes

Every guttered lamp is a **commit partway through an absence**. The loop above finds a crossing,
advances to it, extinguishes a lamp, rebuilds the flow, and re-enters for the rest of the night.

The obvious way to write that re-entry is with a fresh `spanSeconds` measured from where you left
off. It is also the exploit. `W` — the offline warp — is strictly concave, so restarting it pays for
*K absences instead of one*, and every restart begins in the uncapped region again, which makes each
one **cheaper in real time than the last**. Restart often enough and the softcap has simply gone:

```ts
const span = 20 * 3600;
offlineCredit(span, curve);                                   // 35,348 s — one absence
2 * offlineCredit(span / 2, curve);                           // 45,841 s
8 * offlineCredit(span / 8, curve);                           // 72,000 s — the softcap is gone
```

So `CatchUp.fromSeconds` is **required, not optional**. The coordinate system of a plan is *real
seconds from the start of the absence*: `fromSeconds` says where the ledger's anchor currently sits
in it, `spanSeconds` says where this call stops, and the phases are absolute in the same frame and
never need re-basing. The credit for one call is

```
W(spanSeconds) − W(fromSeconds)
```

which telescopes across the whole re-entry sequence to exactly `W(T)`. `Crossing.atSeconds` is in
those same coordinates precisely so it can be handed straight back as the next call's `fromSeconds`.

Writing `fromSeconds: 0` is the deliberate act that says "this is the start of the absence", and a
reviewer can grep for the field and find every re-entry in a codebase.

`CatchUp.curve` is required-and-nullable for the same kind of reason: it is the upper clamp on the
offline gap, and a forgotten optional is how a device clock jump finishes a game. `null` says "I know
this interval is short". At a hydrate seam it is always wrong.

---

## The upper clamp on the gap is the softcap's flat branch

There is no second cap and no configuration for one.

`offlineCredit` clamps its own **input** at `flatAfterSeconds` before the power, so 24 h, 48 h and a
phone whose clock jumped a year all return the identical number — to the bit. At 3 h / 0.625 / 24 h
that number is about 11 hours. A device a year fast credits eleven hours, not a year, and cannot
finish the game.

Two things that follow, because the cap alone is not enough:

1. **A gap is capped; an anchor is not.** `advance` still stamps the ledger at the bogus instant, and
   when the clock is corrected every subsequent read sees time running backwards and credits zero —
   *the economy freezes for a year*, with no error and a save that looks fine. `reanchor` is the
   answer: detect a backwards gap larger than a plausible NTP correction, keep the stocks, move the
   anchor, and be running again on the next frame. That test is two lines and nobody writes it.
2. **The horizon bounds work as well as reward.** With a curve, `advanceOver` stops at the first
   phase beginning at or after `flatAfterSeconds`, because every later one credits exactly zero. A
   phase array generated from a bad device clock cannot cost anything either — 100,000 phases and
   the walk visits the 1,440 inside the horizon.

### `uncappedSeconds` is a design constraint, not just a generosity dial

**If a standing charge accrues on a cycle, `U` must exceed that cycle's period by a wide margin, or
the cycle is skippable.**

The warp shrinks credited time, and shrinking credited time shrinks the *charge* as well as the
income. A game whose night is a standing charge therefore rewards the player for closing the tab
during it: they skip most of the oil bill and most of the darkness. Nothing is minted — burn and
income shrink together — so this is not a dupe, but it is an incentive pointing exactly away from the
intended play.

Keep `U` well above the cycle period and a single-cycle absence is credited in full, so there is
nothing to skip. Set it below the period and every absence discounts the charge. The other two ways
out belong to the designer: let the night *earn* as well as cost, or make the night's punishment
**state** rather than **flow** — lamps that go out and stay out, which `solveCrossing` gives you
exactly.

---

## No tick, no clock, no delta

`sim` reads no clock and accepts no delta. Every call that moves the anchor takes a required
`EpochMillis`, so a frame delta has nowhere to go — and a builder who sees `dt` in `update()` and
reaches for it will find no signature to put it in. That is the intended shape of the refusal.

| quantity | owner | rule |
|---|---|---|
| the fixed-step accumulator and its clamp | `loop` | bounds **work per frame**; `sim` never sees it |
| `dt` in `update` | `loop` | **never an input to this package** |
| the calendar, `() => EpochMillis` | the **game** | read once per frame, at one call site |
| `ledger.atMs` | `sim`'s value, the game's number | only `advance`/`advanceOver` move it |
| `offlineCredit(gap, curve)` | `sim` | bounds **reward per absence** |

Wire it as: **`project` in render, `advance` in the action handler, `advanceOver` at hydrate.**

**Accrual reads `ledger.atMs`, never a save envelope's write stamp.** The stamp is when the record
was *written*; the anchor is when the numbers were last *true*. A debounced write 30 s after the last
`advance` makes them differ by 30 s, and using the stamp pays that interval twice or steals it —
every session, invisibly. To make them agree, `advance` immediately before handing state to a writer.

---

## Cycles are refused at construction, by name

```ts
defineEconomy({
  nodes: ['lamp', 'oil'],
  edges: [{ from: 'oil', to: 'lamp', per: 1 }, { from: 'lamp', to: 'oil', per: 1 }],
});
// RangeError: sim.defineEconomy: production graph has a cycle: lamp → oil → lamp.
// The closed form only terminates on a strictly forward graph; a feedback loop is a
// purchase (an action at an instant), not an edge.
```

There is deliberately **no numerical fallback**. A fallback would be a second implementation of the
economy with different answers, and a game would cross the boundary without noticing — the two would
diverge silently on exactly the saves that matter most. It also breaks the composition identity that
makes one fourteen-hour integration equal fifty thousand one-second ones, which is what makes offline
progress and live play the same code path.

Self-loops are refused for the same reason, by the same call, with the node named.

---

## Determinism: which of this is bit-identical, and which is not

`core`'s two-tier rule applies here more sharply than anywhere else in the kit, because the *most
important* arithmetic in an idle game is Tier B by default: `b · r^k` is a `pow` and the integrator is
a matrix exponential. Two design moves take almost all of this package back to Tier A.

| symbol | tier | why |
|---|---|---|
| `integrate`, `ratesOf`, `advance`, `advanceOver`, `project` | **A** | `Σ Aᵏx₀tᵏ/k!` needs only `+ − × ÷`. The "matrix exponential" never calls `exp` |
| `buildFlow`, `milestoneMultiplier`, `capacityWall`, `capacityShare`, `capacityLoad` | **A** | multiplication and division |
| `costOfNext`, `bulkCost` | **A** | integer exponent → exponentiation by squaring, not `Math.pow` |
| `solveCrossing`, `solveCrossingOver` | **A** | exact to degree 2 (`Math.sqrt`); Horner + a **fixed** 60 bisections above |
| `maxBuyable` | **B seed, A decision** | `Math.log` proposes; the bounded correction disposes |
| `offlineCredit`, `offlineCreditRate` | **B**, or **A** for a dyadic exponent | a fractional power |
| `offlineElapsed` | **B**, or **A** when `1/exponent` is whole | `1/0.5` is 2; `1/0.625` is 1.6, which is not dyadic |

**What the kit promises, precisely.**

- **A replay on the same engine is bit-identical.** Tier B functions are deterministic *within* an
  implementation, and that is the property replay-from-a-log actually needs.
- **Two engines agree to within a few ulps, not to the bit** — and only in the offline warp and the
  `maxBuyable` seed, because everything else is Tier A. A player moving from Firefox to Safari
  mid-run may see credited seconds differ in the sixteenth significant figure.
- **A cost is safe to persist as a *stock*, and not as a *price*.** `bulkCost` and `costOfNext` are
  Tier A, so the number is reproducible — but recompute it rather than storing it and comparing later
  for equality, because the curve's parameters are the durable thing and the price is derived from
  them. A stored price is a fact about one build.
- **`maxBuyable`'s result is advisory.** Never store it, never checksum it, never put it on a wire or
  in a replay log. At an exact boundary two engines can differ by one unit bought. The authoritative
  check is the balance test at purchase time, `bulkCost(curve, owned, n) <= budget`, compared
  **exactly** — an epsilon there would let a player buy something they cannot afford.
- **Never hash or equality-compare a stock vector.** Compare with a relative tolerance of 1e-9. A
  save's checksum must cover the *bytes* read, never a recomputed state.
- **`Infinity` is a perfectly Tier A result and is precisely the value that does not survive being
  written down** — it serializes to `null` with a valid checksum. `advance` and `advanceOver` throw a
  `RangeError` naming the node rather than letting one reach a save, and `expectFiniteStocks` is the
  load-side check. `capacityLoad` is the one derived read here that may be infinite, and it must
  never be stored.

**Pick a dyadic exponent.** `0.5`, `0.625` and `0.75` are computed as a chain of `Math.sqrt` and
multiplies — both exactly specified — so credited time becomes Tier A for free. `0.6` is three per
cent stingier than `0.625` and a whole determinism tier worse. This package ships no default curve,
deliberately (a balance number belongs to a game, not to a kit), but every example here uses 0.625
and the field's own doc says why.

---

## The rest of the surface

| module | what it is for |
|---|---|
| `graph` | `defineEconomy`, `zeroStocks`, `degreeOf` — declare a graph, get a proven evaluation order |
| `flow` | `createFlow`, `buildFlow`, `integrate`, `ratesOf`, `NO_GATES` — rates, and the one-step integrator |
| `ledger` | `Ledger`, `elapsedSeconds`, `project`, `advance`, `reanchor`, `expectFiniteStocks` |
| `offline` | `offlineCredit`, `offlineElapsed`, `maxOfflineCredit`, `offlineCreditRate` |
| `schedule` | `Phase`, `CatchUp`, `advanceOver`, `Crossing`, `solveCrossingOver` |
| `crossing` | `solveCrossing` — the first instant a stock reaches a level |
| `capacity` | `capacityWall`, `capacityShare`, `capacityLoad` |
| `cost` | `costOfNext`, `bulkCost`, `maxBuyable`, `milestoneMultiplier` |
| `ids` | `createIdSource`, `mintId`, `asEntityId` — a saved counter, never reused |

### Capacity: two curves that are not interchangeable

`capacityWall` is `1` at parity and falls **linearly to `0`** at `blackoutAt` times over-draw — for a
constraint the player must *fear*. `capacityShare` is `min(1, supply/demand)` — a queue, for a
constraint that merely *limits*.

Using the wall where you meant the share makes a full road **destroy** the pilgrims past capacity.
Using the share where you meant the wall makes a brownout a tax you can ignore: a bot in the source
game sat at 136 MW of draw against 20 MW of supply for forty minutes, because it could. There is
deliberately no floor on the wall.

Gating is per **edge**, not per node and not global — and anything that *supplies* the gated capacity
leaves its edges untagged. Curtailment sheds load; it does not shut down the generator. A player who
over-builds into total darkness must still be able to earn their way back to a substation, or the
fail state is a dead save rather than a stake.

---

## What is deliberately absent

**A tick**, and its absence is the package. **A clock, and any signature that accepts a delta.**
**Cycles, and a numerical fallback for them.** **Consuming edges and self-loops**, and therefore
exponential decay — a *linear* drain is fully supported and is a forward edge with a negative `per`,
and a flat standing charge is a **source** with a negative `per`. **Any rate that reads a stock this
graph produces**, which is the one thing `EdgeScale` may not close over; everything else about a
rate's shape is yours.
**Clamping**: solve for the crossing and put a boundary there instead, so the clamp becomes a game
event with a time the player can be told about. **Big-number arithmetic** — a game whose numbers
approach 9e15 has a prestige problem, not an arithmetic problem. **Randomness** — the economy is a
differential equation; there is nothing to seed. **A schedule generator** — `sim` consumes `Phase[]`
and does not know what a day is. **Formatting**, which is `core`'s. **Serialization**, which is
`persist`'s: `Ledger` and `IdSource` are JSON-shaped by construction and that is the whole
contribution.

---

## Performance

Measured on the fourteen-node, depth-4 graph in `test/flow.bench.ts`. The frame budget for a whole
Lattice game is 8 ms.

| | ns/op |
|---|---|
| `project` — 14 nodes, depth 4 | ~510 |
| `buildFlow` — 12 edges, one gate | ~90 |
| `ratesOf` | ~490 |
| `integrate` — fourteen hours in one step | ~485 |
| `solveCrossing` — degree 1, any horizon | ~330 |
| `solveCrossing` — degree 4, 60 bisections | ~920 |
| `costOfNext` at 4,000 owned | ~52 |
| `maxBuyable` at 4,000 owned | ~210 |
| `advanceOver` — 1,646 phases, 20-hour absence | ~930,000 |
| `advanceOver` — the same, six-month absence | ~1,120,000 |

The last two rows are the argument. A six-month absence costs the same as a one-day one — the small
difference is that the longer one credits the full 24-hour horizon while the shorter credits 20 hours,
so it walks four more hours of schedule. Nothing in this package scales with how long the player was
away. And `maxBuyable` is about twelve times faster than the 400-iteration buy-loop it replaces, with
the gap widening at every owned count, because one of the two is O(1).
