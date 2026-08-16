# RFC: `@lattice/sim`

> Status: **proposed**. Owner: architect (A8). Implements nothing; a builder follows this.
> Source material: `../foom-simple-ui/src/sim/{cost,flow,offline,resources}.ts`,
> `src/game/state.ts` (the power model), and `PLAYBOOK.md`.

---

## 1. The one sentence

**`@lattice/sim` is the arithmetic of an idle economy in closed form — a production graph you
can integrate in one step, a cost curve you can invert, an offline warp on time, and capacity
gating — with no tick, no clock and no state of its own.**

The load-bearing half of that sentence is *closed form*. Everything else in the kit is a
convenience; this is a package you cannot write on the afternoon you need it, because the two
ideas in it (a nilpotent rate matrix, and a softcap on time rather than on yield) are things
you learn by shipping the bug first.

The unifying rule, which the rest of this document is a consequence of:

> **Everything in `sim` is linear between commits.** Gates, milestones, clamps, purchases and
> unlocks are the discontinuities, and every one of them belongs to the caller, at an instant
> the caller chose. That is precisely what makes one integration of fourteen hours equal to
> fifty thousand integrations of one second.

---

## 2. The five-line example

What a game does with this package ninety per cent of the time: declare the graph once,
rebuild the rate vector when something changed, and *read* the economy at an instant.

```ts
const eco  = defineEconomy({ nodes: ['rack', 'compute'], gates: ['grid'],
                             edges: [{ from: 'rack', to: 'compute', per: 0.5, gate: 'grid' }] });
const flow = createFlow(eco), view = zeroStocks(eco);
buildFlow(eco, save.stocks, { grid: capacityRatio(supplyMW, drawMW, GRID) }, flow); // per frame
project(eco, save, flow, nowMs, view);                        // `view` is the economy, now
```

`save` is a `Ledger<'rack' | 'compute'>` — a stock vector and the epoch-millisecond instant it
is true at. `project` is a **read**: it writes into `view` and touches neither `save` nor the
heap. Nothing above ticks, and nothing above knows what time it is; `nowMs` arrived from
`@lattice/loop`, which is the only package in the kit allowed to own a clock.

The two calls a game makes at a boundary rather than per frame:

```ts
// a purchase resolved at an instant: advance first, then spend
let led = advance(eco, save, flow, elapsedSeconds(save, nowMs), nowMs);
const n = maxBuyable(RACK_COST, owned, led.stocks.compute, 1_000_000);

// coming back after the tab was closed — the whole of offline progress, at the hydrate seam
const gap = elapsedSeconds(save, nowMs);
led = advance(eco, save, flow, offlineCredit(gap, OFFLINE), nowMs);
```

Note the shape of that last pair. **The caller decides how many seconds to credit; `sim`
decides what those seconds produce.** There is no `options.accrual` and no injected warp — the
policy is a function call the game makes in the open, at exactly one place in its codebase,
which is the only way the "apply it once per return" rule below can be checked by reading.

---

## 3. The public surface

Module layout matches `.lattice/kit.json`: `cost`, `graph`, `flow`, `offline`, `capacity`.
`graph` is the module the source game did not have — it hard-coded a resource enum and a
hand-maintained topological array — and it is where most of the new thinking is.

### 3.1 `graph` — declaring a production graph

```ts
/** A stock vector, keyed by node id. Plain JSON: this is what `@lattice/persist` writes. */
export type Stocks<N extends string> = Readonly<Record<N, number>>;

/** The mutable form. Every hot-path function writes into one of these instead of allocating. */
export type StockVec<N extends string> = Record<N, number>;

/**
 * A per-edge multiplier, evaluated **once per `buildFlow`** and held constant across the
 * integration that follows.
 *
 * The milestone mechanic ("every tenth rack doubles what all of them make") is this, in one
 * line: `scale: (s) => milestoneMultiplier(purchased.rack, MILESTONES)`.
 *
 * **Key it on a quantity that only changes when the player acts.** It receives the stock
 * vector at the anchor because that is usually where the count lives, and that is also the
 * trap: keying a milestone on an *effective* count that the flow itself produces puts a rate
 * discontinuity inside an integral, and the same save then answers differently at 10 Hz than
 * it does after one fourteen-hour catch-up. Purchased counts change only at actions. Effective
 * counts change continuously. Use the first.
 */
export type EdgeScale<N extends string> = (stocks: Stocks<N>) => number;

/** One production edge: `d(to)/dt += rate × stock(from)`. Non-consuming — see §6. */
export interface EdgeSpec<N extends string, G extends string> {
  readonly from: N;
  readonly to: N;
  /** Units of `to` per unit of `from` per second, before `scale` and before the gate. */
  readonly per: number;
  /** The capacity that throttles this edge, if any. An untagged edge is never throttled. */
  readonly gate?: G;
  readonly scale?: EdgeScale<N>;
}

export interface EconomySpec<N extends string, G extends string> {
  /**
   * Every node, in **storage** order — the order a save writes its fields in. Deliberately
   * not the evaluation order: append a node in v4 and every v1 save still deserialises with
   * its fields where they were. The evaluation order is computed, not declared.
   */
  readonly nodes: readonly N[];
  /** Capacity ids. Declaring one here is what lets an edge name it. */
  readonly gates?: readonly G[];
  readonly edges: readonly EdgeSpec<N, G>[];
}

export interface Edge<N extends string, G extends string> {
  readonly from: N;
  readonly to: N;
  readonly per: number;
  readonly gate: G | undefined;
  readonly scale: EdgeScale<N> | undefined;
  /** This edge's slot in `Flow.rates`. */
  readonly slot: number;
}

/**
 * A validated, frozen production graph. Build it once at load; it holds no mutable state and
 * two saves may share one.
 */
export interface Economy<N extends string, G extends string = never> {
  /** As declared. The save's field order. */
  readonly nodes: readonly N[];
  /** **Computed** topological order: every producer strictly before everything it produces. */
  readonly order: readonly N[];
  /** Position in `order`. For every edge, `index[from] < index[to]` — this is the invariant. */
  readonly index: Readonly<Record<N, number>>;
  /** Edges, sorted by `index[from]`, so a game reordering its spec cannot move a single ulp. */
  readonly edges: readonly Edge<N, G>[];
  readonly gates: readonly G[];
  /**
   * Edges on the longest path — the nilpotency bound. `A^(depth+1) = 0`, so `x(t)` is a
   * polynomial in `t` of degree exactly `depth` and {@link integrate} performs at most `depth`
   * matrix applications. The source game bounded this by node count (18) for a graph of depth
   * 4; the bound is a property of the graph, not of the vector, and computing it is free.
   */
  readonly depth: number;
}

/**
 * Validate a spec and compute its evaluation order.
 *
 * The order is **derived by Kahn's algorithm and therefore proven**, not asserted against a
 * hand-written array the way the source game did it. A kit cannot ask a game author to keep a
 * topological ordering correct by hand across fourteen resources and two content updates; it
 * can compute one and refuse the graphs that do not have one.
 *
 * @throws RangeError — naming the caller's mistake, per house rule 9 — on: a duplicate node;
 *   an edge naming an undeclared node or an undeclared gate; a non-finite `per`; a self-loop;
 *   or **any cycle**, with the cycle spelled out:
 *   `sim.defineEconomy: production graph has a cycle: compute → heat → compute. The closed
 *   form only terminates on a strictly forward graph; a feedback loop is a purchase (an action
 *   at an instant), not an edge.`
 */
export function defineEconomy<N extends string, G extends string = never>(
  spec: EconomySpec<N, G>,
): Economy<N, G>;

/** A fresh, fully-populated, all-zero vector. Every key present, so the shape stays monomorphic. */
export function zeroStocks<N extends string, G extends string>(eco: Economy<N, G>): StockVec<N>;
```

### 3.2 `flow` — rates and the integrator

```ts
/**
 * The evaluated rate of every edge, plus the integrator's workspace.
 *
 * One `Flow` per simulated world. It is a mutable scratchpad — `integrate` uses buffers inside
 * it — so two states being integrated at the same time need two of them. Treat everything but
 * `rates` as opaque.
 */
export interface Flow {
  /** Effective rate per edge, parallel to `Economy.edges`. Never resized. */
  readonly rates: Float64Array;
}

export function createFlow<N extends string, G extends string>(eco: Economy<N, G>): Flow;

/** The ratios in force, one per declared gate. `1` is healthy; `0` stops the tagged edges. */
export type GateRatios<G extends string> = Readonly<Record<G, number>>;

/** For an economy with no gates. */
export const NO_GATES: GateRatios<never>;

/**
 * Fold `per × scale(stocks) × gateRatio` into `out.rates`.
 *
 * Cheap and allocation-free: one pass over tens of edges. Call it whenever **anything** that
 * feeds a rate has moved — a purchase, a milestone, a brownout. Forgetting to call it after a
 * gate reading changes is the bug where the lights go out and production does not, until the
 * player's next click.
 *
 * @throws RangeError if a declared gate is missing from `gates` or is not finite. An
 *   `undefined` ratio would become `NaN`, and a `NaN` in a stock vector is a corrupted save
 *   that no later call can repair.
 */
export function buildFlow<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  gates: GateRatios<G>,
  out: Flow,
): Flow;

/**
 * Integrate the whole vector forward by `seconds`, exactly, in one step.
 *
 * Evaluates `x(t) = exp(A·t)·x₀ = Σ_k A^k x₀ tᵏ/k!`. Because every edge points strictly
 * forward, `A` is strictly triangular and therefore **nilpotent** — the sum terminates after
 * `eco.depth` terms and is an exact polynomial, not a truncated series. There is no step size
 * here to get wrong, and no stiffness to be afraid of.
 *
 * @param seconds - Non-positive is a no-op that still fills `out`: clocks are not monotonic
 *   across machines or across a laptop suspend, and time appearing to run backwards must never
 *   mint or destroy resources.
 * @throws RangeError if `seconds` is not finite. Silently producing `NaN` stocks corrupts a save.
 * @returns `out`, so a caller can chain. Allocates nothing.
 */
export function integrate<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  seconds: number,
  out: StockVec<N>,
): StockVec<N>;

/**
 * `dx/dt` at this instant — what a HUD prints as "per second".
 *
 * This is the derivative **now** and nothing else. Multiplying it by elapsed time is the
 * classic wrong answer: racks arriving during the next minute make the real accrual
 * super-linear, so the number a player is shown and the number they get would disagree, in the
 * player's disfavour, by more the better they are doing. To answer "how much in the next
 * minute", call {@link integrate} with 60 and subtract.
 */
export function ratesOf<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  out: StockVec<N>,
): StockVec<N>;
```

### 3.3 The ledger, and the `loop`/`sim` boundary on time

```ts
/**
 * A stock vector and the instant it is true at. This is the whole of `sim`'s state, and it is
 * a value — JSON-round-trippable as-is, which is what `@lattice/persist` stores.
 */
export interface Ledger<N extends string> {
  readonly stocks: Stocks<N>;
  /** Epoch milliseconds, from the host clock. There is no clock inside this package. */
  readonly atMs: number;
}

/** `(atMs − ledger.atMs) / 1000`, clamped at zero. The one place the ms→s conversion lives. */
export function elapsedSeconds<N extends string>(ledger: Ledger<N>, atMs: number): number;

/**
 * Integrate to an instant **without committing**, into a caller-owned vector.
 *
 * This is what a HUD calls every frame. It changes nothing, allocates nothing, and always
 * integrates from the same anchor — so the answer is one expression evaluated at a later `t`,
 * not an accumulation. Folding a per-frame projection back into the anchor is arithmetically
 * fine and *reproducibility poison*: the state then depends on how many frames the player's
 * laptop managed, which is the end of replay from a seed and an input log (non-negotiable #1).
 *
 * @returns the seconds integrated — `elapsedSeconds(ledger, atMs)`, i.e. `0` for a backwards clock.
 */
export function project<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  atMs: number,
  out: StockVec<N>,
): number;

/**
 * Move the anchor, crediting `creditedSeconds` of production.
 *
 * Two parameters, deliberately: the anchor always lands on `atMs`, and the production credited
 * for getting there is whatever the caller says. Live play passes `elapsedSeconds(...)`; a
 * return from an absence passes `offlineCredit(elapsedSeconds(...), curve)`. `sim` has no
 * opinion about which, because the moment it does, it owns a clock policy it cannot see the
 * inputs to.
 *
 * Allocates one `Ledger` and one vector. It is a boundary call — an action, a save, a hydrate
 * — not a per-frame one.
 */
export function advance<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  creditedSeconds: number,
  atMs: number,
): Ledger<N>;
```

**The contract with `@lattice/loop`, stated so it can be checked against loop's RFC:**

| quantity | owner | rule |
|---|---|---|
| `nowMs` | `loop` | injected host clock; `sim` never reads one and `npm run lint` enforces it |
| the fixed-step accumulator, and the clamp on it | `loop` | bounds **work per frame**; a tab restored after an hour must not run an hour of ticks |
| `ledger.atMs` | `sim`'s value, `loop`'s number | `sim` stores it; only `advance` moves it; only the host produces it |
| `elapsedSeconds(ledger, nowMs)` | `sim` computes, from parameters | the single contiguous gap; never derived from a clock |
| `offlineCredit(gap, curve)` | `sim` | bounds **reward per absence** |
| the decision of which to pass to `advance` | the **game**, at one call site | not `loop`, not `sim` |

Four rules fall out, and each one is a bug if broken in either direction:

1. **`loop`'s catch-up clamp must never be applied to the number handed to `sim`.** They bound
   different things: loop's clamp exists so a restored tab does not run 216,000 fixed steps in
   one frame; sim's warp exists so eight hours of sleep is worth about five. Clamping sim's
   seconds with loop's clamp silently steals the player's entire night, and it looks exactly
   like a working game.
2. **`sim` never runs inside the fixed-step tick.** It is integrated on read. A game that calls
   `advance` from `loop`'s `step` callback has reinvented the tick, and its economy becomes a
   function of frame rate. The correct wiring is: `project` in `render`, `advance` in the
   action handler and at hydrate.
3. **The gap is measured once, at the hydrate seam, from `ledger.atMs` to the host's `nowMs`.**
   Not from a separate "last seen" timestamp, not from `loop`'s accumulated time. `loop` may
   well know how long it was paused; it must not be the source of this number, because the
   ledger's anchor is the only endpoint that survived the tab being closed.
4. **`loop` owns the wake signal; `sim` owns what the wake is worth.** `loop` is the package
   that notices `visibilitychange` and a resumed clock. All it should do is hand the game
   `nowMs` and say "you were away"; the game then calls `offlineCredit` + `advance`. If loop's
   RFC has loop calling anything in `sim`, one of us is wrong — the dependency graph says
   `loop` and `sim` are siblings and neither imports the other.

### 3.4 `offline` — the warp on time

```ts
/**
 * Uncapped for `uncappedSeconds`, softcapped at `exponent`, flat after `flatAfterSeconds`.
 * The shipping numbers in the source game: 3 h, 0.6, 24 h.
 */
export interface OfflineCurve {
  readonly uncappedSeconds: number;
  /** In (0, 1]. Above 1 pays a bonus for leaving, which is not a softcap. */
  readonly exponent: number;
  readonly flatAfterSeconds: number;
}

/**
 * Credited seconds for a **single contiguous absence**.
 *
 * ```
 *            ⎧ T                  0 ≤ T ≤ U     second for second
 *     W(T) = ⎨ U · (T/U)^e        U < T ≤ F     softcapped
 *            ⎩ U · (F/U)^e        T > F         flat — the curve stops rising
 * ```
 *
 * A warp on **time**, never on yield. Scaling the output afterwards lets a player return from
 * fourteen hours with more of a downstream resource than their producers could have made in
 * the credited window — a dupe with a plausible-looking formula. Warping the clock cannot,
 * because every edge in the graph sees the same shortened interval.
 *
 * The `U^(1−e)` normalisation is the whole trick; see §6 for the two near-misses.
 *
 * @throws RangeError if `elapsedSeconds` is not finite, or the curve is degenerate
 *   (`U ≤ 0`, `e ∉ (0,1]`, `F < U`) — a balance pass is a data diff, so a bad number arrives
 *   as data and must be caught where it is read, not three hours into a run.
 */
export function offlineCredit(elapsedSeconds: number, curve: OfflineCurve): number;

/** The most any absence can ever be worth. Derived from the curve, never restated. */
export function maxOfflineCredit(curve: OfflineCurve): number;

/**
 * `dW/dt` — "the next second away is worth this much of a second". A read for the UI; the
 * integrator never needs it. Reported as the *right* derivative at the knot, because what a
 * player wants to know is what the next second pays: it steps 1 → `exponent` at `U`.
 */
export function offlineCreditRate(elapsedSeconds: number, curve: OfflineCurve): number;
```

**`W` does not compose, and must never be asked to.** It is strictly concave, therefore
subadditive: two twelve-hour gaps credit *more* than one twenty-four-hour gap. No choice of
curve fixes this, because a softcap that composed additively would be linear, i.e. not a
softcap. So the semantics are: **apply it exactly once per return, over the one gap between the
ledger's anchor and now.** A player who genuinely opened the tab at hour twelve was away for two
gaps and is correctly paid more, because they did in fact come back. Splitting is generous,
which is the safe direction: nobody is punished for a visit the game failed to record.

### 3.5 `capacity` — gating as a first-class primitive

Power supply multiplies every producer, so the fourth server rack browns out the whole campus
at once. That single mechanic is what turns an idle curve into a game — it is the first moment
the player's own success is the thing hurting them — and no idle library has it as a primitive.

```ts
export interface CapacityCurve {
  /**
   * Demand ÷ supply at which output reaches zero. Must be > 1. The source game ships 1.5.
   *
   * **A brownout is a wall, not a tax.** The first version of this clamped the ratio at 0.2,
   * which meant a player could sit at 136 MW of draw against 20 MW of supply indefinitely,
   * running at a fifth speed and simply ignoring it — a bot did exactly that for forty
   * minutes in testing. A constraint you can shrug off is not a constraint. There is
   * deliberately no `floor` option here.
   */
  readonly blackoutAt: number;
}

/**
 * The multiplier every gated edge is scaled by: `1` at or under parity, falling linearly to
 * `0` at `blackoutAt` times over-draw.
 *
 * `supply <= 0` with any demand is `0`. `demand <= 0` is `1`.
 */
export function capacityRatio(supply: number, demand: number, curve: CapacityCurve): number;

/**
 * `demand / supply`, for the meter — the number a HUD paints amber at 0.8 so that 18 of 20 does
 * not look like 6 of 20. `0` when demand is zero, `Infinity` when supply is zero and demand is
 * not; never `NaN`, because a `NaN` reaches the player as an empty progress bar.
 */
export function capacityLoad(supply: number, demand: number): number;
```

**Where supply and demand come from is the game's business, and that is the design.** `sim`
cannot know that a building under construction supplies nothing and draws nothing (it must not:
a substation that browns out the campus for the forty-five seconds before it helps it reads as
a bug no matter how defensible the simulation is), nor that a rival cut your firm supply, nor
that capacity committed to a training run is *subtracted* rather than reserved. The game
computes two numbers per frame and hands in a ratio.

**"Gated by power, but its build timer is not"** — three separate answers, in order of how often
they apply:

1. **A build timer is not in the economy at all.** It is a `@lattice/loop` timer or a scheduled
   callback. `sim` has no timers, so this case needs no expressive power; it is answered by the
   package boundary.
2. **Gating is per *edge*, not per node and not global.** A building that produces compute and
   also produces progress-toward-completion declares two edges and tags only one:
   ```ts
   edges: [
     { from: 'rack',  to: 'compute',  per: 0.5,  gate: 'grid' },  // throttled by the grid
     { from: 'crew',  to: 'progress', per: 0.02 },                // untagged: never throttled
   ]
   ```
3. **The generator exemption is the same mechanism, and it is a safety valve, not a nicety.**
   Curtailment sheds load; it does not shut down the generator. Anything that *supplies* the
   gated capacity leaves its edges untagged, which is what makes a hard blackout floor
   survivable: a player who over-builds into total darkness can still earn their way back to a
   substation. A fail state you cannot dig out of is not a stake, it is a dead save.

One gate per edge, not a list. A gate id is a named *operating condition*, not a resource: a
rack line constrained by both grid and cooling is one availability number the player is shown in
one HUD row, and a game that wants the product declares `gates: ['rackLine']` and computes
`gates.rackLine = capacityRatio(mw…) * capacityRatio(litres…)` itself. Naming the combination is
better documentation than a list of ids, and it keeps `buildFlow` a single multiply per edge.

**The gate ratio is constant across an integration.** It is read once, at `buildFlow`, and held.
This is the same argument that makes the whole package work — rates are constant because
purchases happen at instants — and it is honest about its limit: if a game's supply is itself
*produced* by the flow, the true ratio drifts during a long interval and the closed form uses
the ratio at the anchor. The fix is the caller's, and it is not a hidden loop: `advance` more
often. Capacity gating makes the system piecewise-linear in time, and **the pieces are the
caller's commits.**

### 3.6 `cost` — the curve, in closed form

```ts
/** `cost(k) = base · growth^k`. `growth` must be > 1 in a shipping balance. */
export interface CostCurve {
  readonly base: number;
  readonly growth: number;
}

/** `b · r^k` — the price of the next single unit. */
export function costOfNext(curve: CostCurve, owned: number): number;

/**
 * `b · r^k · (r^n − 1)/(r − 1)` — the price of `count` more, starting from `owned`.
 *
 * @returns `0` for `count <= 0`; `Infinity` if the geometric term overflows, which compares
 *   correctly against any finite balance and therefore *refuses* the purchase rather than
 *   silently making it free.
 * @throws RangeError on a non-integer `count` or a non-finite curve parameter.
 */
export function bulkCost(curve: CostCurve, owned: number, count: number): number;

/**
 * `floor( log_r( c(r−1)/(b·r^k) + 1 ) )`, corrected for float rounding, clamped to `cap`.
 *
 * **Closed form on day one, not as an optimisation.** "Buy max" at 4,000 owned is 4,000
 * `Math.pow` calls on a hot path, run once per frame to render a button's *label*. The naive
 * loop is a legitimate oracle in a test and a performance bug in a build.
 *
 * The guarantee callers rely on is two-sided, and both halves are asserted at the boundaries:
 * `bulkCost(curve, owned, maxBuyable(...)) <= budget` (a `max` purchase can never drive a
 * balance negative) and `bulkCost(curve, owned, maxBuyable(...) + 1) > budget` (the button says
 * what it does). A bounded rounding correction of at most four steps after the logarithm is a
 * rounding fix, not a search — `cap` bounds arithmetic, never CPU.
 *
 * @param budget - Zero, negative and `NaN` all yield `0` rather than throwing: an empty wallet
 *   is a normal state, not an error.
 */
export function maxBuyable(
  curve: CostCurve,
  owned: number,
  budget: number,
  cap: number,
): number;

/** Ascending thresholds, each multiplying once. The source ships ×2 at 10 / 20 / 35 / 50. */
export interface Milestones {
  readonly thresholds: readonly number[];
  readonly multiplier: number;
}

/**
 * The multiplier from milestone bonuses at an owned count.
 *
 * Feed this **purchased** counts, never effective ones — see {@link EdgeScale}. It is a pure
 * function of a number so that a game can also use it on a shop card, which is where players
 * actually learn the mechanic exists.
 */
export function milestoneMultiplier(owned: number, milestones: Milestones): number;
```

### 3.7 The export list for `.lattice/kit.json`

Values: `VERSION`, `defineEconomy`, `zeroStocks`, `createFlow`, `buildFlow`, `NO_GATES`,
`integrate`, `ratesOf`, `elapsedSeconds`, `project`, `advance`, `offlineCredit`,
`maxOfflineCredit`, `offlineCreditRate`, `capacityRatio`, `capacityLoad`, `costOfNext`,
`bulkCost`, `maxBuyable`, `milestoneMultiplier`.

Types: `Stocks`, `StockVec`, `EdgeScale`, `EdgeSpec`, `EconomySpec`, `Edge`, `Economy`, `Flow`,
`GateRatios`, `Ledger`, `OfflineCurve`, `CapacityCurve`, `CostCurve`, `Milestones`.

Twenty values. I do not think any of them can be removed without a game having to hand-roll
something that is easy to get subtly wrong, and I would rather defend twenty than thirty. The
`sim` entry's `invariants` array should be replaced with §5's first four.

---

## 4. What is deliberately absent

**1. A tick.** There is no `step(dt)`, and its absence is the package. A function that steps the
economy N times answers differently at different frame rates, and cannot answer "where would
this player be after fourteen hours?" without doing fourteen hours of work. If a future task
adds one for convenience, offline progress stops being three lines and becomes a subsystem.

**2. A clock.** No `Date.now`, no `performance.now`, no default for `atMs`. Enforced by
`npm run lint`, and the reason a test can fast-forward a week with no timers.

**3. Cycles, and a numerical fallback for them.** `defineEconomy` **refuses**, naming the cycle,
and I considered falling back to RK4 and rejected it. Three reasons, in order of weight: (a) a
fallback is a *second implementation of the economy* with different answers, and a game would
cross the boundary without noticing, so the two would silently diverge on exactly the saves that
matter most; (b) it would break the composition identity — one 14-hour integration equalling
50,400 one-second ones is not a nicety, it is what makes offline progress and replay-from-a-log
the same code path, and no fixed-step numerical scheme has it; (c) a cycle in an idle economy is
nearly always a design error wearing a mechanic's clothes — "compute buys racks" is a
*purchase*, an action applied at an instant, and modelling it as a flow edge would also make it
consuming, which is the separate prohibition below. Refusing is honest, it happens at load
rather than at hour three, and the error message can name the exact edge to delete. A friendly
fallback that quietly changes what your game's numbers mean is not friendlier.

**4. Consuming edges, self-loops, and therefore decay.** An edge subtracts nothing from its
source. A consuming edge puts a negative term on the diagonal, `A` stops being nilpotent, and
the closed form stops terminating. This is the one absence I expect to be argued with, because
"hype decays", "heat dissipates" and "narrative starts decaying, visibly" are real mechanics —
the source game hit exactly this and kept decay *out* of the matrix, integrating `n(t) = n₀e^(−λt)`
in isolation because nothing produced that node. That trick works only while the decaying node
has no in-edges. Doing it properly means `exp(At)` for a triangular matrix with repeated
eigenvalues — divided differences, and real numerical care near coincident rates. It is a
genuine piece of work, it is the strongest candidate for v2, and shipping a half version of it
would be worse than not having it. Until then: decay is a step the game applies at a commit
boundary, or a gate ratio it recomputes.

**5. Clamping.** No caps, no floors, no "a stock may not go negative". A clamp is a nonlinearity,
and a nonlinearity inside `integrate` would be invisible: the function would still return
numbers, they would just no longer be the integral of anything, and the composition invariant
would fail by an amount that depends on how often you called it. Storage caps and non-negative
stocks belong at the caller's commit boundaries, where they are visible and where the game can
tell the player about them.

**6. Big-number arithmetic — `BigInt`, `Decimal`, layered exponents.** See §5's floating-point
invariant for the full argument. Nothing, deliberately.

**7. Randomness.** The economy is a differential equation; there is nothing to seed. `sim` does
not import `Rng` from `core`, and a crit chance or a lucky-tick mechanic is the game's, applied
at an instant, with the game's own seeded stream.

**8. An action/commit layer.** The source's best structural idea — *the offline-progress function
and the anti-cheat function are the same function* — lives in its `commit(state, actions, now)`,
and I am not porting it, because it requires an action vocabulary and a kit has no business
inventing one. `advance` is the half of it that generalises. The other half belongs to the game
(and is worth writing down in the demo).

**9. Formatting.** `4.72M` is `@lattice/core`'s `format`, not sim's. Related trap for whoever
owns it: `toFixed(0)` switches to exponential at 1e21 and puts `e+` into a UI string.

**10. Serialisation and migration.** `Ledger` is JSON-shaped by construction and that is the
entire contribution; versioning it is `@lattice/persist`'s.

**11. A rate breakdown.** "Why is my number what it is" — one multiplier line per effect, with
running totals — is one of the best features in the source game and every idle game needs it. It
is not here because once `buildFlow` has folded gate × scale × base into one rate, the
decomposition is gone, and reconstructing it would mean a second, slower path that could
disagree with the first. Named as a gap in §6 instead; it wants to be built where the multipliers
are still separate, which is the game's.

---

## 5. Invariants a reviewer can test

Each is phrased so that a failure is unambiguous. These are the tests I would write first.

**I1 — the order is proven, not assumed.** For every `edge` in `eco.edges`,
`eco.index[edge.from] < eco.index[edge.to]`. *Fails as:* a graph with an edge pointing backwards
in `order` builds successfully.

**I2 — every cycle is refused at construction.** For a spec containing any cycle, including a
self-loop, `defineEconomy` throws a `RangeError` whose message contains the id of a node on the
cycle. *Fails as:* a cyclic spec returns an `Economy`, or `integrate` returns `Infinity` later.

**I3 — the result is a polynomial of degree `eco.depth`.** Sample `integrate` at
`t = 0, 1, …, depth + 1` with a fixed flow; the `(depth + 1)`-th finite difference of every node
is zero to within 1e-9 relative. *Fails as:* the integrator truncates a series, iterates a fixed
number of terms, or takes small steps.

**I4 — path independence.** `integrate(x, t₁ + t₂)` equals `integrate(integrate(x, t₁), t₂)` to
1e-9 relative, for a fixed flow and fixed gates, including `t₁ + t₂ = 50,400 s` split 600 ways.
*Fails as:* any hidden accumulation, or a rate rebuilt mid-interval.

**I5 — declaration order does not change a single ulp.** Shuffle the `edges` array of a spec and
the integrated result is *bit-identical*. (This is why `Economy.edges` is stored sorted by
`index[from]`: float addition is not associative, so the accumulation order has to be fixed by
the package rather than by the game's text file.)

**I6 — a gate is exactly a rate multiplier.** Integrating with `gates.grid = 0.5` is
bit-identical to integrating the same graph with that edge's `per` halved and no gate.
*Fails as:* a gate applied per node, per term, or after integration.

**I7 — `maxBuyable` is two-sided.** With `n = maxBuyable(c, k, budget, cap)`:
`bulkCost(c, k, n) <= budget`, and `bulkCost(c, k, n + 1) > budget` unless `n === cap`. Sweep
`budget` across the exact boundaries `bulkCost(c, k, m)` for `m` in 0…200. *Fails as:* a button
that says 12 and buys 11, or a balance that goes negative.

**I8 — `bulkCost` matches a naive loop.** For `n` up to 200, within 1e-9 relative of
`Σ costOfNext(c, k + i)`. The loop is the oracle; it is only ever allowed in a test.

**I9 — the offline curve is continuous, monotone and never generous.** `W(U) === U` exactly;
`|W(U + ε) − U| < 1e-6`; `W` non-decreasing; `W(T) <= T` for all `T`; `W(T) === W(F)` for every
`T > F` (clamp the *input*, so 48 h and 72 h return the identical value 24 h returns rather than
approaching it — coming back later must never pay more). *Fails as:* the two classic near-misses
in §6.

**I10 — the capacity curve is a wall.** `capacityRatio(s, s, c) === 1` exactly;
`capacityRatio(s, s * c.blackoutAt, c) === 0`; strictly decreasing in demand between them;
`capacityRatio(0, d>0, c) === 0`; `capacityRatio(s, 0, c) === 1`. No output is ever `NaN`.

**I11 — time never runs backwards into resources.** `project` and `advance` with an `atMs`
earlier than the anchor credit exactly zero and destroy nothing.

**I12 — the hot path allocates nothing.** A benchmark of 100,000 `project` calls shows no growth
in heap used and no GC pause above the frame budget; `project`, `integrate`, `ratesOf` and
`buildFlow` each return the `out` object they were handed.

**I13 — determinism.** The same inputs produce bit-identical outputs across runs and across
platforms, and `src/` contains no `Math.random`, `Date.now` or `performance.now` (lint).

**I14 — floating point, stated as a boundary rather than a defence.**

A `double` holds every integer exactly up to `2^53` (9,007,199,254,740,992 —
`Number.MAX_SAFE_INTEGER` is one below it). Past that the spacing between representable values
is 2, then 4, then 128 by `2^60`, and about 131,072 by 1e21. Relative precision never degrades —
every result is within half an ulp, so a cost of 1e300 is still accurate to fifteen significant
figures — so **the magnitude is fine and the integers are not.** Two places it bites, and only
two:

- **Spending becomes free.** With a balance of 1e17 and a cost of 3, `balance - cost === balance`.
  The player buys forever. This is the actual bug; every other symptom is cosmetic.
- **Costs saturate.** At `growth = 1.07`, `costOfNext` crosses `2^53` at about 520 owned and
  reaches `Infinity` at about 10,500 owned. The first is reachable in a long session; the second
  is reachable by a save left alone for a week.

**What the kit does about it: nothing, deliberately.** No `BigInt`, no `Decimal`, no
mantissa/exponent pair. Four reasons: (a) it would infect every signature in the kit — `iso`,
`draw` and `ui` all take `number`, and a game would spend its life converting at boundaries;
(b) every arbitrary-precision type allocates per operation, which loses non-negotiable #7 on the
hot path this package exists to protect; (c) 12 KB gzipped per package, and a bignum library is
most of that budget on its own; (d) determinism — IEEE-754 doubles are bit-identical across
platforms by specification, and a software bignum is only as reproducible as its own rounding
code.

What it does instead, and what a reviewer should check: `bulkCost` returns `Infinity` on
overflow rather than a wrapped or negative number, so an unaffordable purchase is *refused*
(never silently free); `maxBuyable` is clamped by `cap`, so a single transaction is bounded;
`integrate` throws on non-finite `seconds` rather than writing `NaN` into a save. And the design
answer, which is the real one: **a game whose numbers approach 9e15 has a prestige problem, not
an arithmetic problem.** Every shipped idle game resets the ladder before this magnitude for
pacing reasons long before it reaches it for numerical ones. If a game genuinely needs to run
past it, that is a new package (`@lattice/bignum`) and a deliberate decision, not a silent
upgrade of every `number` in the kit.

---

## 6. The traps

What a naive implementation gets wrong. Every one of these is either written down in
`../foom-simple-ui`'s module docs and `PLAYBOOK.md`, or is the direct consequence of a shape in
this RFC.

**T1 — the buy loop.** Implementing "buy max" by looping purchases. 4,000 `Math.pow` calls per
frame to render a label, and the same loop again on any authority that revalidates it. Closed
form on day one.

**T2 — off-by-one in `maxBuyable`, in both directions.** `Math.log` and `**` are each accurate to
an ulp or two, so the analytic answer lands on the right integer *or one either side*. The fix is
a bounded correction of at most four steps with the two-sided invariant asserted afterwards — not
a search, and not a fudge factor.

**T3 — partial spends.** A fixed batch is all-or-nothing: asking for ×10 with funds for six must
buy nothing, not six. Only `max` resolves against the balance. (Applies to the game, but a kit
that quietly returned six would have taught it the wrong shape.)

**T4 — milestones on effective counts.** The single subtlest bug in the package. If a multiplier
keys on a count the flow itself produces, the rate changes *inside* the integral, and a client
integrating at 10 Hz places the discontinuity somewhere different from a catch-up integrating
once — the same save, two answers, neither reproducible. Key milestones on purchased counts.

**T5 — scaling yield instead of time for offline.** A dupe with a plausible formula: the player
returns with more downstream resource than their upstream producers could have made in the
credited window. Warp the clock, not the output.

**T6 — the two offline near-misses.** `W(T) = U + T^e` drops the `U^(1−e)` normalisation and
jumps by `U^e` at the knot — about 259 credited seconds at the shipping numbers — so returning at
3h00m01s pays more than returning at 2h59m59s: a visible, farmable step. `W(T) = U + (T − U)^e` is
continuous and wrong in a subtler direction: its slope at `U⁺` is *infinite* because `e < 1`, so
for the first seconds past the knot the player earns faster than live, and closing the tab at
2h59m becomes the optimal play. A softcap that opens by paying a bonus is not a softcap. The
correct form has `W(U) = U` exactly and the slope stepping *down* from 1 to `e`.

**T7 — applying the warp more than once per return.** It is concave, so splitting a gap pays
more. Twice per return is a slow leak that only shows up in aggregate, and a second call site is
the usual cause (a "welcome back" card that recomputes the credit to display it, then advances).
Compute once, pass the number to both.

**T8 — folding a projection back into the anchor.** `project` at 10 Hz then storing the result
gives a state that is correct and not reproducible: it now depends on the player's frame rate.
Move the anchor only where a replay would, i.e. at actions and at hydrate.

**T9 — crediting a backwards clock.** Laptop suspends, NTP corrections and a user setting their
system clock back all produce `atMs < ledger.atMs`. Zero, never negative, never `Math.abs`.

**T10 — the brownout as a tax.** Clamping the ratio at a floor. A bot ignored a 136/20 over-draw
for forty minutes, running at a fifth speed, because it could. Linear to zero at `blackoutAt`.

**T11 — gating the generator.** If the edges that *produce* the gated capacity are themselves
throttled by it, a total blackout is unrecoverable and the save is dead. Leave supply-side edges
untagged; curtailment sheds load, it does not shut down the generator.

**T12 — counting buildings that are not finished.** A substation under construction that already
draws power browns out the campus for the forty-five seconds before it helps it. This is the
game's `supply`/`demand` calculation, not sim's, and it is the first thing to check when a
brownout looks like a bug.

**T13 — forgetting `buildFlow` after a gate reading changes.** Rates are cached in the `Flow`. A
game that rebuilds only after a purchase will show the lights going out with production
unaffected until the player's next click. Rebuild whenever *anything* feeding a rate moved; it is
one pass over tens of edges.

**T14 — sharing one `Flow` between two worlds.** It carries the integrator's scratch buffers. Two
concurrent integrations through one `Flow` interleave their intermediate terms and produce
garbage that is not obviously garbage. One per world.

**T15 — clamping inside `integrate`.** Adding a storage cap "just for this one node" makes the
function stop being an integral, and I4 will fail by an amount that depends on how often you
called it. Clamp at commit boundaries.

**T16 — `!` on an indexed lookup.** Under `noUncheckedIndexedAccess`, `eco.order[i]` is
`N | undefined` and the tempting fix is `!`. In the source game exactly this shipped a black
screen to two of four biomes: the type was the bug report. Iterate the arrays; index through
`eco.index`, whose keys are proven total by construction.

**T17 — running `sim` inside the fixed-step tick.** See §3.3. It compiles, it looks right, and it
makes the economy a function of frame rate.

**T18 — anything that is not painting living in `requestAnimationFrame`.** rAF is 0 Hz in a
hidden tab. A HUD driven only by the frame loop freezes with stale prices and stale disabled
states in a backgrounded tab and looks broken. The economy itself is immune — that is the point
of integrating on read — but the readout is not. `loop`'s problem; worth knowing here because
"the numbers stopped" will be reported against `sim` first.

---

## 7. Gaps this RFC found that belong elsewhere

- **`@lattice/loop`** — needs a wake/visibility signal that hands the game `nowMs` and the fact
  that it was away, without itself calling into `sim` (§3.3, rule 4). It also owns T18.
- **`@lattice/persist`** — `Ledger.stocks` and `Ledger.atMs` must be written **atomically**. A
  save that persists stocks but an older anchor pays the player twice for the same interval on
  every load; the reverse steals it. Persist should treat the pair as one value. Also, a save
  flushed on `pagehide` will happily overwrite a `localStorage.clear()`, which cost the source
  game real debugging time.
- **`@lattice/core`** — compact big-number formatting (`4.72M`), with the `toFixed`→exponential
  cliff at 1e21 handled.
- **Nobody's, and it should be somebody's** — the rate breakdown (§4.11): one line per multiplier
  with a running total, so a player who cannot see why a number moved can still make a decision
  about it. It wants to live where the multipliers are still separate, which is the demo game;
  if the demo finds itself writing it twice, it is a `ui` primitive.
- **Nobody's, deliberately for now** — the "recompute, never inspect" commit function (§4.8). If
  the demo grows an authority of any kind, that is the shape to reach for.
