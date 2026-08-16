# RFC: `@lattice/sim`

> Status: **proposed**. Owner: architect (A8). Implements nothing; a builder follows this.
> Source material: `../foom-simple-ui/src/sim/{cost,flow,offline,resources}.ts`,
> `src/game/state.ts` (the power model), and `PLAYBOOK.md`.
>
> **Revised after three routings**, all of which changed the shape rather than adding to it:
> the demo (A10) needs alternating piecewise rates and a closed-form depletion time; `core`
> pushed entity ids here and named `pow`/`exp`/`log` as Tier B; `loop` refused the epoch and
> handed this package the whole of offline time. §3.5, §3.6, §3.9 and §3.10 are the new
> material, and §3.3 is rewritten.

Every signature below type-checks against this preamble:

```ts
import type { EpochMillis } from '@lattice/core';   // see §7: core is asked to add it
// If core declines: `type EpochMillis = number;` here, and the seam loses its name.
declare const entityBrand: unique symbol;
```

---

## 1. The one sentence

**`@lattice/sim` is the arithmetic of an idle economy in closed form — a production graph you
can integrate in one step, a cost curve you can invert, an offline warp on time, capacity
gating, and the instant a stock runs out — with no tick, no clock and no state of its own.**

The load-bearing half of that sentence is *closed form*. Everything else in the kit is a
convenience; this is a package you cannot write on the afternoon you need it, because the ideas
in it — a nilpotent rate matrix, a softcap on time rather than on yield, and a root-find where
everyone else writes a loop — are things you learn by shipping the bug first.

The unifying rule, which the rest of this document is a consequence of:

> **Everything in `sim` is linear between commits.** Gates, milestones, clamps, purchases,
> nightfall and a stock hitting zero are the discontinuities, and every one of them is a
> *boundary* — an instant at which the caller re-enters. That is what makes one integration of
> fourteen hours equal to fifty thousand integrations of one second.

The three routings all pushed on the same place, and the answer is the same in each case: a
boundary is not a tick. A tick's cost scales with elapsed time. A boundary's cost scales with
**how many interesting things happened**, and `sim`'s job is to find those instants exactly
rather than to walk past them at 60 Hz hoping to notice.

---

## 2. The five-line example

Declare the graph once, rebuild the rate vector when something changed, and *read* the economy
at an instant.

```ts
const eco  = defineEconomy({ nodes: ['lamp', 'oil'], gates: ['dark'],
                             edges: [{ from: 'lamp', to: 'oil', per: -1, gate: 'dark' }] });
const flow = createFlow(eco), view = zeroStocks(eco);
buildFlow(eco, save.stocks, { dark: night ? 1 : 0 }, flow);      // once a frame
project(eco, save, flow, nowMs, view);                           // `view` is the economy, now
```

`save` is a `Ledger<'lamp' | 'oil'>` — a stock vector and the epoch instant it is true at.
`project` is a **read**: it writes into `view` and touches neither `save` nor the heap. Nothing
above ticks, and nothing above knows what time it is; `nowMs` came from the game's one calendar
function (§3.3).

Note what nightfall is: a gate ratio of 1 instead of 0. The lamps' oil burn is an edge that
exists all day and is throttled to nothing while the sun is up. The whole day/night economy is
one number changing, which is the shape the rest of this document is built to preserve.

The three calls a game makes at a boundary rather than per frame:

```ts
// a purchase, resolved at an instant: advance first, then spend
let led = advance(eco, save, flow, elapsedSeconds(save, nowMs), nowMs);
const n = maxBuyable(LAMP_COST, owned, led.stocks.coin, 1_000_000);

// when do the lamps gutter? — an exact instant, not a search through frames
const t = solveCrossing(eco, led.stocks, flow, 'oil', 0, secondsUntilDawn);

// coming back after the tab was closed: the whole of offline progress, at the hydrate seam
led = advanceOver(eco, save, flow, { spanSeconds: gap, phases: nights(gap), curve: OFFLINE }, nowMs);
```

**The caller decides when the boundaries are; `sim` decides what happens between them, and
solves for the ones the caller could not have known in advance.**

---

## 3. The public surface

Modules: `cost`, `graph`, `flow`, `offline`, `capacity`, and — argued for in §3.9 — `ids`.
`.lattice/kit.json` should gain that sixth name. `graph` is the module the source game did not
have (it hard-coded a resource enum and a hand-maintained topological array) and it is where
most of the new thinking is.

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
 * The milestone mechanic ("every tenth press doubles what all of them make") is this, in one
 * line: `scale: () => milestoneMultiplier(game.pressesBought, MILESTONES)`.
 *
 * **Key it on a quantity that only changes when the player acts.** It receives the stock vector
 * at the anchor because that is often where the count lives, and that is also the trap: keying
 * a milestone on an *effective* count that the flow itself produces puts a rate discontinuity
 * inside an integral, and the same save then answers differently at 10 Hz than it does after
 * one fourteen-hour catch-up. Purchased counts change only at actions. Effective counts change
 * continuously. Use the first.
 */
export type EdgeScale<N extends string> = (stocks: Stocks<N>) => number;

/** One production edge: `d(to)/dt += rate × stock(from)`. Non-consuming — see §4. */
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
   * Every node, in **storage** order — the order a save writes its fields in. Deliberately not
   * the evaluation order: append a node in v4 and every v1 save still deserialises with its
   * fields where they were. The evaluation order is computed, not declared.
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
 * can compute one, and refuse the graphs that do not have one.
 *
 * Validation uses `core`'s `guard` validators, which return the value rather than take a
 * boolean — so every message can name the offending node instead of reporting that something,
 * somewhere, was false.
 *
 * @throws RangeError — naming the caller's mistake, per house rule 9 — on: a duplicate node; an
 *   edge naming an undeclared node or an undeclared gate; a non-finite `per`; a self-loop; or
 *   **any cycle**, with the cycle spelled out:
 *   `sim.defineEconomy: production graph has a cycle: oil → lamp → oil. The closed form only
 *   terminates on a strictly forward graph; a feedback loop is a purchase (an action at an
 *   instant), not an edge.`
 */
export declare function defineEconomy<N extends string, G extends string = never>(
  spec: EconomySpec<N, G>,
): Economy<N, G>;

/** A fresh, fully-populated, all-zero vector. Every key present, so the shape stays monomorphic. */
export declare function zeroStocks<N extends string, G extends string>(eco: Economy<N, G>): StockVec<N>;

/**
 * The degree of `node`'s trajectory in `t`: the longest path *into* it, so `1` is linear and
 * `2` is quadratic. Exported because it is the precondition of an exact depletion solve (§3.6)
 * and a game is entitled to know, at design time, whether the instant it wants to report is
 * algebraically available or found by bisection.
 */
export declare function degreeOf<N extends string, G extends string>(eco: Economy<N, G>, node: N): number;
```

### 3.2 `flow` — rates and the integrator

```ts
/**
 * The evaluated rate of every edge, plus the integrator's workspace.
 *
 * One `Flow` per simulated world. It is a mutable scratchpad — `integrate` and `solveCrossing`
 * use buffers inside it — so two states being advanced at the same time need two of them.
 * Treat everything but `rates` as opaque.
 */
export interface Flow {
  /** Effective rate per edge, parallel to `Economy.edges`. Never resized. */
  readonly rates: Float64Array;
}

export declare function createFlow<N extends string, G extends string>(eco: Economy<N, G>): Flow;

/** The ratios in force, one per declared gate. `1` is healthy; `0` stops the tagged edges. */
export type GateRatios<G extends string> = Readonly<Record<G, number>>;

/** For an economy with no gates. */
export declare const NO_GATES: GateRatios<never>;

/**
 * Fold `per × scale(stocks) × gateRatio` into `out.rates`.
 *
 * Cheap and allocation-free: one pass over tens of edges. Call it whenever **anything** that
 * feeds a rate has moved — a purchase, a milestone, nightfall, a brownout. Forgetting to call
 * it after a gate reading changes is the bug where the sun goes down and the oil does not
 * start burning until the player's next click.
 *
 * @throws RangeError if a declared gate is missing from `gates` or is not finite. An
 *   `undefined` ratio becomes `NaN`, and a `NaN` in a stock vector is a corrupted save that no
 *   later call can repair.
 */
export declare function buildFlow<N extends string, G extends string>(
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
 * here to get wrong and no stiffness to be afraid of.
 *
 * Uses only `+ - * /`: **Tier A**, bit-identical across engines given the same rates (§3.10).
 *
 * @param seconds - Non-positive is a no-op that still fills `out`: clocks are not monotonic
 *   across machines or across a laptop suspend, and time appearing to run backwards must never
 *   mint or destroy resources.
 * @throws RangeError if `seconds` is not finite. Silently producing `NaN` stocks corrupts a save.
 * @returns `out`, so a caller can chain. Allocates nothing.
 */
export declare function integrate<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  seconds: number,
  out: StockVec<N>,
): StockVec<N>;

/**
 * `dx/dt` at this instant — what a HUD prints as "per second".
 *
 * This is the derivative **now** and nothing else. Multiplying it by elapsed time is the classic
 * wrong answer: presses arriving during the next minute make the real accrual super-linear, so
 * the number a player is shown and the number they get disagree — in the player's disfavour, by
 * more the better they are doing. To answer "how much in the next minute", integrate 60 and
 * subtract.
 */
export declare function ratesOf<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  out: StockVec<N>,
): StockVec<N>;
```

### 3.3 The ledger, the calendar, and the `loop`/`sim` boundary

```ts
/**
 * A stock vector and the instant it is true at. This is the whole of `sim`'s state, and it is a
 * value — JSON-round-trippable as-is, which is what `@lattice/persist` writes.
 *
 * `atMs` is an **epoch** timestamp and nothing else will do. Not `loop.time`, not a duration
 * accumulated on the fixed step, not `performance.now()`. See the four rules below.
 */
export interface Ledger<N extends string> {
  readonly stocks: Stocks<N>;
  readonly atMs: EpochMillis;
}

/** `(atMs − ledger.atMs) / 1000`, clamped at zero. The one place the ms→s conversion lives. */
export declare function elapsedSeconds<N extends string>(ledger: Ledger<N>, atMs: EpochMillis): number;

/**
 * Integrate to an instant **without committing**, into a caller-owned vector.
 *
 * This is what a HUD calls every frame. It changes nothing, allocates nothing, and always
 * integrates from the same anchor — so the answer is one expression evaluated at a later `t`,
 * not an accumulation. Folding a per-frame projection back into the anchor is arithmetically
 * fine and *reproducibility poison*: the state then depends on how many frames the player's
 * laptop managed, which is the end of replay from a seed and an input log.
 *
 * @returns the seconds integrated — `elapsedSeconds(ledger, atMs)`, i.e. `0` for a backwards clock.
 */
export declare function project<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  atMs: EpochMillis,
  out: StockVec<N>,
): number;

/**
 * Move the anchor, crediting `creditedSeconds` of production.
 *
 * Two parameters, deliberately: the anchor always lands on `atMs`, and the production credited
 * for getting there is whatever the caller says. Live play passes `elapsedSeconds(...)`. An
 * absence with a schedule uses {@link advanceOver} instead, which is the only function in this
 * package permitted to apply a warp, because distributing one across phases is the thing you
 * must not do by hand (§3.5).
 *
 * An `atMs` earlier than the anchor returns the ledger **unchanged** — it neither credits nor
 * moves the anchor backwards, because an anchor that can be walked back is an interval that can
 * be credited twice. Correcting a bad clock is {@link reanchor}, deliberately a different call.
 *
 * Allocates one `Ledger` and one vector. It is a boundary call — an action, a save, a hydrate —
 * not a per-frame one.
 *
 * @throws RangeError if the resulting vector is not finite, naming the node — see below.
 */
export declare function advance<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  creditedSeconds: number,
  atMs: EpochMillis,
): Ledger<N>;

/**
 * Move the anchor **without crediting anything**, in either direction.
 *
 * The clock-correction tool, and the only function here that may move an anchor backwards.
 * `advance` deliberately refuses to: an anchor that can be walked back is an interval that can
 * be credited twice.
 *
 * It exists because of the forward clock jump. A phone whose date is a year ahead hands the game
 * a gap of 31.5 million seconds; the credit for that is capped (§3.4), but the *anchor* is not —
 * it lands a year in the future, and when the clock is corrected every subsequent read sees time
 * running backwards and credits zero. **The economy then freezes for a year.** That is a far
 * worse outcome than over-crediting and no cap on the credit prevents it.
 *
 * So: a game that detects `atMs < ledger.atMs` by more than a plausible drift (a few seconds of
 * NTP correction) calls this, keeps its stocks, forfeits nothing it had earned, and is running
 * again on the next frame.
 */
export declare function reanchor<N extends string>(ledger: Ledger<N>, atMs: EpochMillis): Ledger<N>;
```

#### What a ledger may contain

Raised by `persist`: **`Infinity` serializes to `null` in JSON, with a perfectly valid
checksum** — the worst possible failure, because every layer reports success and the state comes
back with a hole in it. A closed-form integrator is exactly the thing that can produce one.

```ts
/**
 * Validate a stock vector, returning it. `guard`-shaped, for the same reason `core`'s validators
 * are: a boolean has already thrown away the node that was wrong.
 *
 * Call it on anything that came out of `JSON.parse`. A `null` where a number should be (an
 * `Infinity` that made a round trip) and a `NaN` (which `JSON.stringify` also writes as `null`)
 * are both caught here, at the one boundary where the value can still be blamed on the save
 * rather than on the arithmetic.
 *
 * @throws RangeError naming the first offending node: `sim.load: stocks.oil is not finite (null)`.
 */
export declare function expectFiniteStocks<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  label: string,
): Stocks<N>;
```

**Is a non-finite stock reachable?** Yes, but only through a balance error, and the shape of the
graph is why. Growth here is **polynomial** in elapsed time — degree `eco.depth` — not
exponential, so no single absence can carry a sane balance to 1.8e308. What can is compounding
across sessions: a graph with no sink multiplies its stocks by a polynomial factor every
catch-up, which is exponential in *session count*, and a runaway balance will find `Infinity`
eventually. A stock at `Infinity` therefore means *the economy has no answer*, not that it has a
very large one — it cannot be rendered, compared or spent, and one `Infinity` becomes a `NaN`
downstream on the first `0 × ∞`, which poisons every comparison in the game.

**Where it is refused:** at the boundary between a number and a *durable* number.

| call | checks the result? | why |
|---|---|---|
| `integrate`, `project`, `ratesOf` | **no** | per-frame. A non-finite `view` is garbage on screen for one frame, which is visible and harmless |
| `advance`, `advanceOver` | **yes** — throws, naming the node | these produce the value that reaches a save. One pass over the nodes at a boundary call is free |
| `defineEconomy` | non-finite `per` only | it cannot know a stock it has never seen |

That throw is not a dead end: it is the input to `persist`'s "corrupt save → fresh, with a
reported reason" path. The alternative — writing the vector and letting `Infinity` become `null`
— produces a bug filed against `persist` and caused by `sim`, which is exactly the outcome this
paragraph exists to prevent.

One consequence for the rest of this surface: **`capacityLoad` deliberately returns `Infinity`**
for zero supply. It is a derived read for a meter. It is not a stock, and a game that stores it
has just written a `null` into its own save.

#### The contract with `@lattice/loop` — ratified

`loop`'s side, which I accept without amendment: **`loop` credits nothing, ever.** It clamps
catch-up at 250 ms per pump and drops the excess; `loop.time` deliberately drifts below real
time and runs at roughly quarter speed in a hidden tab; its clock is monotonic and **has no
epoch**, so it cannot stamp anything. *The loop advances callbacks; `sim` advances value.*

My side, stated so the two can be checked against each other:

| quantity | owner | rule |
|---|---|---|
| the fixed-step accumulator, and the clamp on it | `loop` | bounds **work per frame**; `sim` never sees it |
| `dt` in `update` | `loop` | **never an input to this package.** Not clamped, not summed, not scaled |
| the calendar, `() => EpochMillis` | the **game** | read once per frame, at one call site, passed to `persist` and to `sim` |
| `ledger.atMs` | `sim`'s value, the game's number | only `advance`/`advanceOver` move it; `sim` never invents it |
| `elapsedSeconds(ledger, nowMs)` | `sim`, from parameters | the single contiguous gap |
| `offlineCredit(gap, curve)` | `sim` | bounds **reward per absence** |
| which of those to pass | the **game**, at one call site | not `loop`, not `sim` |

Four rules, each a bug if broken in either direction:

1. **The integrator is driven from a stored epoch timestamp, never from summed `dt`.** This is
   `loop`'s explicit ask and it costs me nothing, because the anchor was always in the state:
   `(stocks, rates, lastTimestamp)`, integrated on read. Concretely, `sim` exposes **no function
   that takes a delta** — `project` and `advance` take an *instant* and derive the interval from
   the ledger. A builder who sees `dt` in `update()` and reaches for it will find no signature
   to put it in, which is the intended shape of the refusal.
2. **`loop`'s catch-up clamp must never touch the number handed to `sim`.** They bound different
   things: loop's clamp exists so a restored tab does not run 216,000 fixed steps in one frame;
   sim's warp exists so eight hours of sleep is worth about five. Passing loop's clamped or
   dropped time to `sim` silently steals the player's entire night, and it looks exactly like a
   working game. `stats.droppedSeconds` is diagnostics; it is not an earnings feed.
3. **`sim` never runs inside the fixed-step tick.** It is integrated on read. `advance` inside
   `loop.step` reinvents the tick and makes the economy a function of frame rate — and, given
   rule 2, a function of whether the tab was visible. Wire it as: `project` in render, `advance`
   in the action handler and at hydrate.
4. **`loop` owns the wake cadence; `sim` owns what the wake is worth.** `loop.real` decides
   *when* a hydrate or a save happens; the number that goes into either comes from the game's
   calendar function. Neither package imports the other, and neither should: they are siblings
   in the layer graph.

#### The saved-at seam, my third of it

`persist` stamps the record; `loop` refuses; here is what `sim` owns, with no hedging.

| question | `sim`'s answer |
|---|---|
| what does accrual read? | **`ledger.atMs`, and only that.** It is the instant the *vector* is true at |
| is that the same as `SaveEnvelope.t`? | **No, and conflating them is the bug.** The stamp is when the record was *written*; the anchor is when the numbers were last *true*. A debounced write 30 s after the last `advance` makes them differ by 30 s |
| which is right for the gap? | The anchor. Using the stamp pays a debounce interval twice, or steals it, depending on which way the two drift — every session, invisibly |
| how do I make them agree? | `advance` immediately before handing state to a writer. Then `envelope.t === ledger.atMs` and any mismatch is a bug in the save path that a test can assert on |
| what about `persist.elapsedSince`? | It is `persist`'s own quantity — staleness, cross-tab, "welcome back" copy. It is **not** the accrual input, and it will be short by the debounce interval if used as one |
| how is forgetting the timestamp made impossible? | Every entry point that moves the anchor takes `atMs` as a **required, non-optional** parameter. There is no overload without it, no default, and no `sim` function that reads a clock. Omitting it is a compile error rather than an elapsed time of fifty-six years |
| can the type catch passing the *wrong* clock? | Not today. `EpochMillis = number` accepts `loop.time`, which is monotonic, has no epoch and runs at quarter speed while hidden — the single most damaging substitution available in the kit. §7 asks `core` for a branded `EpochMillis` and a checked constructor; I would take it |

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
 * fourteen hours with more of a downstream resource than their producers could have made in the
 * credited window — a dupe with a plausible-looking formula. Warping the clock cannot, because
 * every edge in the graph sees the same shortened interval.
 *
 * The `U^(1−e)` normalization is the whole trick; see §6 for the two near-misses.
 *
 * @tier B in general — a fractional `**`. **Tier A when `exponent` is a dyadic rational with
 *   denominator ≤ 64** (0.5, 0.75, 0.625, …), which the implementation must compute as a chain
 *   of `Math.sqrt` and multiplies rather than `**`. A game that needs credited time to be
 *   bit-identical across engines picks 0.625 instead of 0.6 and gets it for free. See §3.10.
 * @throws RangeError if `elapsedSeconds` is not finite, or the curve is degenerate (`U ≤ 0`,
 *   `e ∉ (0,1]`, `F < U`) — a balance pass is a data diff, so a bad number arrives as data and
 *   must be caught where it is read, not three hours into a run.
 */
export declare function offlineCredit(elapsedSeconds: number, curve: OfflineCurve): number;

/**
 * `W⁻¹` — the real elapsed time at which `creditedSeconds` of credit had accrued.
 *
 * The map back from the physics to the calendar, and the reason a game can say "the lamps went
 * out at 3:41 into the second night" rather than "at 1:52 of credited time, which is not a
 * thing the player experienced". Exact and closed form: the identity below `U`, and
 * `U·(c/U)^(1/e)` above it.
 *
 * @returns `Infinity` for a credit above `maxOfflineCredit(curve)` — no amount of real time
 *   reaches it, which is what "flat" means.
 */
export declare function offlineElapsed(creditedSeconds: number, curve: OfflineCurve): number;

/** The most any absence can ever be worth. Derived from the curve, never restated. */
export declare function maxOfflineCredit(curve: OfflineCurve): number;

/**
 * `dW/dt` — "the next second away is worth this much of a second". A read for the UI; the
 * integrator never needs it. Reported as the *right* derivative at the knot, because what a
 * player wants to know is what the next second pays: it steps 1 → `exponent` at `U`.
 */
export declare function offlineCreditRate(elapsedSeconds: number, curve: OfflineCurve): number;
```

**`W` does not compose, and must never be asked to.** It is strictly concave, therefore
subadditive: two twelve-hour gaps credit *more* than one twenty-four-hour gap. No choice of
curve fixes this, because a softcap that composed additively would be linear, i.e. not a
softcap. So: **apply it exactly once per return, over the one gap between the ledger's anchor
and now.** A player who genuinely opened the tab at hour twelve was away for two gaps and is
correctly paid more, because they did in fact come back. Splitting is generous, which is the
safe direction: nobody is punished for a visit the game failed to record.

#### The upper clamp on the gap — mine, and it is the flat branch

`persist` clamps the elapsed gap at zero from below and deliberately leaves the ceiling to me, on
the grounds that it is a balance decision. Agreed, and here it is explicitly.

**The cap is `maxOfflineCredit(curve)` — `U · (F/U)^e`, about 37.6 ks (10.4 h) at the shipping
numbers — and it applies to the *credit*, never to the gap.** `offlineCredit` clamps its own
**input** at `flatAfterSeconds` before the power, so 24 h, 48 h and a device whose clock jumped a
year all return the identical number. There is no second cap to add and no configuration for one:
the flat branch of the softcap **is** the ceiling, which is why the curve has three parameters
rather than two.

So a phone that wakes up a year ahead credits 10.4 hours, not a year, and cannot finish the game.
Three things that follow, because the cap alone is not enough:

1. **A gap is capped; an anchor is not.** The credit is bounded, but `advance` still stamps the
   ledger at the bogus instant, and when the clock is corrected the economy freezes until real
   time catches up. That is the more damaging half of a forward jump and {@link reanchor} is the
   answer to it (§3.3).
2. **The cap only exists if you pass the curve.** `CatchUp.curve` is therefore *required and
   explicitly nullable* (§3.5) — you must write `curve: null` to opt out, which is a deliberate,
   greppable act rather than a forgotten optional field. At a hydrate seam, `null` is always
   wrong.
3. **Reporting the gap and crediting it are different questions.** `sim` never rewrites the raw
   elapsed time; a game showing "you were away for a year" from a bad device clock is a copy
   problem, and a game that wants to say something skeptical instead compares the gap against its
   own plausibility threshold. Only the game knows its session cadence, so only the game can set
   that number.

`curve.flatAfterSeconds` is also a **horizon**. Nothing after it credits anything, which is what
makes §3.5 finite.

### 3.5 Schedules — an alternating rate, warped, without a tick

Routed by A10: *"production runs at one rate by day and another by night, and the boundaries
move, because every night is longer than the last. A constant-rate accrual warp is the obvious
`offline` design and it cannot cross those boundaries."*

Correct, and here is the shape that can. The insight is that **`W` warps a scalar, so it
distributes across a partition of the absence by evaluation at the boundaries, not by
re-application.**

For an absence `[0, T]` cut into phases `0 = a₀ < a₁ < … < a_K = T`, phase *i* is credited

```
    W(a_{i+1}) − W(a_i)          seconds
```

and the pieces sum to exactly `W(T)`, because the sum telescopes. `W` is evaluated at
**absolute offsets from the start of the absence and never restarted**, so the once-per-return
rule above is not merely preserved — it is the mechanism. Each piece is then one exact
closed-form integration with that phase's gate ratios in force.

```ts
/** One piece of a piecewise-constant schedule. */
export interface Phase<G extends string> {
  /**
   * Offset in seconds from the ledger's anchor at which this phase begins. Strictly ascending
   * across the array, and the first must be `0`.
   */
  readonly atSeconds: number;
  /** The gate ratios in force during it. */
  readonly gates: GateRatios<G>;
}

/** An absence, and the schedule that ran during it. */
export interface CatchUp<G extends string> {
  /** The **real-time** span of the absence in seconds — `elapsedSeconds(ledger, atMs)`. */
  readonly spanSeconds: number;
  /**
   * Ascending phases covering `[0, min(spanSeconds, curve.flatAfterSeconds)]`.
   *
   * Generating phases beyond the horizon is harmless and pointless: every one of them credits
   * exactly zero seconds. That bound is what keeps this finite — for the demo's 45 s days and
   * `15 + 9d` second nights, a 24-hour horizon is about 270 pieces, and **so is a six-month
   * absence**.
   */
  readonly phases: readonly Phase<G>[];
  /**
   * The warp, or an explicit `null` for live time.
   *
   * **Required and nullable rather than optional**, because this field is the upper clamp on the
   * offline gap (§3.4) and a forgotten optional is how a device clock jump becomes a finished
   * game. `null` says "I know this interval is short" — a live frame, an action boundary — and
   * at a hydrate seam it is always wrong. A reviewer can grep for it.
   */
  readonly curve: OfflineCurve | null;
}

/**
 * Advance across a piecewise-constant schedule, applying the warp once across the whole span
 * and distributing it across the phases by evaluation at their boundaries.
 *
 * This takes a *curve* rather than a *number* — the opposite of {@link advance}, and the
 * asymmetry is the point. With one phase there is nothing to distribute and the caller may as
 * well warp the scalar itself. With a schedule, distributing the warp by hand is exactly the
 * thing that goes wrong: restarting `W` at each phase pays a player for K absences instead of
 * one, and the error grows with how long they were away.
 *
 * Cost is O(phases × edges × depth) — semantic boundaries, not fixed steps. Doubling the length
 * of the absence past the horizon does not change it at all: with a curve, the walk **stops at
 * the first phase beginning at or after `curve.flatAfterSeconds`**, because every later one
 * credits exactly zero. That makes the horizon a hard bound on work as well as on reward, so a
 * phase array generated from a bad device clock cannot cost anything either.
 *
 * @throws RangeError if the phases are not ascending, do not start at 0, or name a gate the
 *   economy did not declare.
 * @throws RangeError if the resulting vector is not finite, naming the node — see §3.3.
 */
export declare function advanceOver<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  plan: CatchUp<G>,
  atMs: EpochMillis,
): Ledger<N>;
```

**Why this is not a tick, stated so an auditor can hold me to it.** A tick's step size is
arbitrary and its count scales with elapsed time; halving the step changes the answer, and the
answer converges rather than being right. Here, the pieces are the instants at which the *rate
actually changed* — nightfall, dawn, a purchase — every piece is integrated exactly, and
subdividing a piece returns a bit-identical answer (invariant I4). A schedule with no changes is
one step, however long the absence.

**The schedule itself is the game's.** `sim` does not generate one, does not know what a day is,
and has no calendar. A10's own capability matrix calls a cycle clock "~8 lines of game code,
acceptable"; the eight lines produce `Phase[]`, and this package consumes them.

### 3.6 Crossings — solving for the instant a stock runs out

Also routed by A10: *"the far lamps went out at 3:41 into the second night"*, live and offline,
and finding it by ticking is what the no-tick invariant forbids.

```ts
/**
 * The first instant within `[0, horizonSeconds]` at which `node` reaches `level`, or `Infinity`
 * if it does not.
 *
 * Because the graph is nilpotent, `x_node(t)` is a polynomial of degree `degreeOf(eco, node)`
 * whose coefficients are `Aᵏx₀/k!` — the same terms {@link integrate} already computes. So this
 * is a root-find on an exact polynomial, not a search through time:
 *
 * | degree | method | exactness |
 * |---|---|---|
 * | 0 | constant; crosses only if it already equals `level` | exact |
 * | 1 | `t = (level − x₀)/c₁` | exact, one divide, **Tier A** |
 * | 2 | quadratic formula, with the cancellation-safe branch | exact, **Tier A** (`Math.sqrt`) |
 * | ≥ 3 | isolate roots by recursing on the derivative, then bisect each monotone segment to
 *   machine precision | first root guaranteed; ~60 Horner evaluations per segment |
 *
 * **The degree-≥3 path is still not a tick, and the difference is the whole argument.** A tick's
 * cost scales with the length of the interval; bisection's cost scales with the number of *bits
 * in the answer*. A fourteen-hour horizon and a one-second horizon both cost 60 iterations, the
 * result is accurate to an ulp rather than to a frame, and it does not change if the player's
 * machine is slower. Isolating on the derivative's roots is what makes it find the *first*
 * crossing rather than whichever one the bracket happened to contain — a stock that dips, is
 * rescued, and drains again must report the dip.
 *
 * Above degree 4 there is also no algebraic alternative to want: Abel–Ruffini says the general
 * quintic has no solution in radicals, so "closed form for any graph" is not a thing anyone can
 * ship. That is a theorem, not a budget. What a game gets instead is an exact answer for the
 * shapes that occur — a resource drained by a fixed set of consumers is degree 1, which is the
 * demo's oil and most idle games' everything — and a deterministic, interval-independent answer
 * beyond them.
 *
 * @param level - Usually `0`. Crossings in either direction are found; the caller knows which
 *   side it started on.
 * @returns seconds from `stocks`, or `Infinity`. Never negative, never `NaN`.
 */
export declare function solveCrossing<N extends string, G extends string>(
  eco: Economy<N, G>,
  stocks: Stocks<N>,
  flow: Flow,
  node: N,
  level: number,
  horizonSeconds: number,
): number;

/** Where a crossing landed, in both clocks. */
export interface Crossing {
  /** **Real** seconds from the anchor — what a player experienced. `Infinity` if it never crosses. */
  readonly atSeconds: number;
  /** **Credited** seconds from the anchor — where it sits in the physics. */
  readonly creditedSeconds: number;
  /** Index into `plan.phases`, or `-1` for no crossing. */
  readonly phase: number;
}

/**
 * The same solve, across a whole schedule: walk the phases, integrate each exactly, and solve
 * inside the first one whose endpoints straddle `level`.
 *
 * The two clocks in {@link Crossing} are why this exists rather than being a loop in game code.
 * The physics happens in credited time; the sentence the player reads is in real time, and the
 * map between them is {@link offlineElapsed} evaluated at the phase's own offset. Getting that
 * backwards produces a toast that is confidently wrong about when the lights went out — by a
 * factor that grows the longer the player was away.
 *
 * Allocates one `Crossing`. A hydrate-boundary call.
 */
export declare function solveCrossingOver<N extends string, G extends string>(
  eco: Economy<N, G>,
  ledger: Ledger<N>,
  flow: Flow,
  plan: CatchUp<G>,
  node: N,
  level: number,
): Crossing;
```

**A crossing is how a nonlinearity becomes a boundary.** `sim` does not clamp (§4.5), so a game
whose oil hits zero does not want a clamped integral — it wants *the instant*, so it can put a
commit there, extinguish the top lamp, rebuild the flow and carry on. The guttering sequence is
therefore a loop bounded by **the number of lamps**, not by time:

```ts
for (;;) {
  const t = solveCrossing(eco, led.stocks, flow, 'oil', 0, untilDawn);
  if (t === Infinity) break;
  led = advance(eco, led, flow, t, led.atMs + t * 1000);
  extinguishTopLamp();                                   // a game action, at an instant
  buildFlow(eco, led.stocks, gates, flow);               // one fewer lamp burning
}
```

That is five lines, exact, and it produces the emotional core of the demo's middle game. It is
also the answer to "what happens outside the exactly-solvable class": nothing changes, because
the loop above is driven by crossings whatever their degree.

### 3.7 `capacity` — gating as a first-class primitive

Power supply multiplies every producer, so the fourth server rack browns out the whole campus at
once. That single mechanic is what turns an idle curve into a game — it is the first moment the
player's own success is the thing hurting them — and no idle library has it as a primitive.

There are **two** curves here and they are not interchangeable. Choosing wrongly is the most
consequential balance mistake this package can be an accessory to.

```ts
export interface CapacityCurve {
  /**
   * Demand ÷ supply at which output reaches zero. Must be > 1. The source game ships 1.5.
   *
   * **A brownout is a wall, not a tax.** The first version clamped the ratio at 0.2, which meant
   * a player could sit at 136 MW of draw against 20 MW of supply indefinitely, running at a
   * fifth speed and simply ignoring it — a bot did exactly that for forty minutes in testing.
   * A constraint you can shrug off is not a constraint. There is deliberately no `floor` here.
   */
  readonly blackoutAt: number;
}

/**
 * The wall: `1` at or under parity, falling **linearly to `0`** at `blackoutAt` times over-draw.
 * For a constraint the player must fear — power, wicks, anything whose breach is an event.
 *
 * `supply <= 0` with any demand is `0`. `demand <= 0` is `1`. Tier A.
 */
export declare function capacityWall(supply: number, demand: number, curve: CapacityCurve): number;

/**
 * The share: `min(1, supply / demand)`. A queue, not a wall — everyone present gets a slice and
 * nothing collapses. For a constraint that merely *limits*: a road that holds only so many
 * pilgrims, a market that absorbs only so much.
 *
 * Using the wall where you meant the share makes a full road *destroy* the pilgrims past
 * capacity. Using the share where you meant the wall makes a brownout a tax you can ignore for
 * forty minutes. Tier A.
 */
export declare function capacityShare(supply: number, demand: number): number;

/**
 * `demand / supply`, for the meter — the number a HUD paints amber at 0.8 so that 18 of 20 does
 * not look like 6 of 20. `0` when demand is zero, `Infinity` when supply is zero and demand is
 * not; never `NaN`, because a `NaN` reaches the player as an empty progress bar.
 */
export declare function capacityLoad(supply: number, demand: number): number;
```

**Where supply and demand come from is the game's business, and that is the design.** `sim`
cannot know that a building under construction supplies nothing and draws nothing (it must not:
a substation that browns out the campus for the forty-five seconds before it helps it reads as a
bug no matter how defensible the simulation is), nor that a rival cut your firm supply, nor that
capacity committed to a training run is *subtracted* rather than reserved. The game computes two
numbers per frame and hands in a ratio.

**"Gated by power, but its build timer is not"** — three answers, in order of how often they
apply:

1. **A build timer is not in the economy at all.** It is a `loop` timer or a scheduled callback.
   `sim` has no timers, so this case needs no expressive power: it is answered by the package
   boundary. (And per `loop`'s rule 2, a build timer that must be true against the player's wall
   clock is a timestamp in `sim` state or a `loop.real` timer — never the fixed step.)
2. **Gating is per *edge*, not per node and not global.**
   ```ts
   edges: [
     { from: 'rack', to: 'compute',  per: 0.5,  gate: 'grid' },  // throttled by the grid
     { from: 'crew', to: 'progress', per: 0.02 },                // untagged: never throttled
   ]
   ```
3. **The generator exemption is the same mechanism, and it is a safety valve.** Curtailment sheds
   load; it does not shut down the generator. Anything that *supplies* the gated capacity leaves
   its edges untagged, which is what makes a hard blackout survivable: a player who over-builds
   into total darkness can still earn their way back to a substation. A fail state you cannot dig
   out of is not a stake, it is a dead save.

One gate per edge, not a list. A gate id is a named *operating condition*, not a resource: a rack
line constrained by both grid and cooling is one availability number the player sees in one HUD
row, and a game that wants the product declares `gates: ['rackLine']` and computes
`gates.rackLine = capacityWall(...) * capacityShare(...)` itself. Naming the combination is
better documentation than a list of ids, and it keeps `buildFlow` one multiply per edge.

**The gate ratio is constant across an integration**, read once at `buildFlow` and held. Same
argument as everything else here — and §3.5 is what makes the limit livable: a gate that changes
on a schedule is a phase boundary, and a gate that changes because a *stock* crossed a threshold
is a crossing (§3.6). Both are boundaries the caller can find exactly. Capacity gating makes the
system piecewise-linear in time, and **the pieces are the caller's commits.**

### 3.8 `cost` — the curve, in closed form

```ts
/** `cost(k) = base · growth^k`. `growth` must be > 1 in a shipping balance. */
export interface CostCurve {
  readonly base: number;
  readonly growth: number;
}

/**
 * `b · r^k` — the price of the next single unit.
 *
 * Computed by **exponentiation by squaring**, not `Math.pow`: `owned` is an integer, so the
 * price is a chain of multiplications and therefore Tier A and bit-identical everywhere. `**`
 * would be one ulp more accurate and not reproducible, and for a number a player is charged,
 * reproducible wins. See §3.10.
 *
 * @throws RangeError on a non-integer `owned` or a non-finite curve parameter.
 */
export declare function costOfNext(curve: CostCurve, owned: number): number;

/**
 * `b · r^k · (r^n − 1)/(r − 1)` — the price of `count` more, starting from `owned`. Tier A, for
 * the same reason.
 *
 * @returns `0` for `count <= 0`; `Infinity` if the geometric term overflows, which compares
 *   correctly against any finite balance and therefore *refuses* the purchase rather than
 *   silently making it free.
 * @throws RangeError on a non-integer `count` or a non-finite parameter.
 */
export declare function bulkCost(curve: CostCurve, owned: number, count: number): number;

/**
 * `floor( log_r( c(r−1)/(b·r^k) + 1 ) )`, corrected for float rounding, clamped to `cap`.
 *
 * **Closed form on day one, not as an optimization.** "Buy max" at 4,000 owned is 4,000
 * `Math.pow` calls on a hot path, run once per frame to render a button's *label*. The naive
 * loop is a legitimate oracle in a test and a performance bug in a build.
 *
 * The guarantee callers rely on is two-sided, and both halves are asserted at the boundaries:
 * `bulkCost(curve, owned, maxBuyable(...)) <= budget` (a `max` purchase can never drive a
 * balance negative) and `bulkCost(curve, owned, maxBuyable(...) + 1) > budget` (the button says
 * what it does). The bounded correction of at most four steps after the logarithm is a rounding
 * fix, not a search — `cap` bounds arithmetic, never CPU.
 *
 * This is the one Tier B call left in the package, and it is a **seed**: `Math.log` proposes an
 * integer and the correction loop verifies it with Tier A comparisons, so two engines can only
 * disagree if their logarithms differ by enough to move the answer four steps. They do not.
 *
 * @param budget - Zero, negative and `NaN` all yield `0` rather than throwing: an empty wallet
 *   is a normal state, not an error.
 */
export declare function maxBuyable(
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
 * The multiplier from milestone bonuses at an owned count. Repeated multiplication, so Tier A.
 *
 * Feed it **purchased** counts, never effective ones — see {@link EdgeScale}. It is a pure
 * function of a number so a game can also use it on a shop card, which is where players actually
 * learn the mechanic exists.
 */
export declare function milestoneMultiplier(owned: number, milestones: Milestones): number;
```

### 3.9 `ids` — identity for a simulated world

Routed from `core`, which will not hold a counter because layer 0 has no module-level mutable
state. Accepted: `sim` owns the shape of a simulated world, and a game that has to invent this
reaches for `Math.random()` or `Date.now()`, both of which the constitution bans and neither of
which replays. This adds a sixth module to `kit.json`'s list for `sim`.

```ts
/**
 * An identity for a thing in the world — a lamp, a building, a pilgrim with a name.
 *
 * A `number` at runtime and in JSON; branded so that a lamp id cannot be passed where a tile
 * index is wanted. The one cast that constructs one lives inside {@link mintId}.
 */
export type EntityId = number & { readonly [entityBrand]: true };

/**
 * The allocator. Its entire state is one integer, and that integer **must be saved**.
 *
 * `next` is deliberately mutable: this is the one value in the package that is not a value.
 */
export interface IdSource {
  next: number;
}

/** @throws RangeError if `next` is not a non-negative integer — a corrupt save, caught at load. */
export declare function createIdSource(next?: number): IdSource;

/**
 * Take the next id. Monotone, and **never reused**.
 *
 * Recycling a freed id is the ABA bug in a game: a reference held to a lamp that was
 * extinguished silently becomes a reference to the lamp built afterwards, and the symptom
 * appears three systems away. At one mint per millisecond a counter reaches
 * `Number.MAX_SAFE_INTEGER` in 285,000 years, so there is nothing to reclaim.
 *
 * Deterministic by construction: ids are handed out in the order actions are applied, so a
 * replay from a seed and an input log mints the same ids for the same things. This is why the
 * counter is here and not derived from a clock or an `Rng` — a time-derived id cannot replay,
 * and a random one would consume a stream that the rest of the game is also drawing from.
 */
export declare function mintId(source: IdSource): EntityId;

/**
 * Narrow a number that came back from a save.
 *
 * Ids arrive from `JSON.parse` as plain numbers, so a load boundary needs exactly one checked
 * cast — and that check is worth having for its own sake: **an id at or above `source.next` is
 * proof the counter was not saved with the entities.** That save will re-issue live ids and
 * merge two entities into one, which is unrecoverable and silent. Fail at load instead.
 *
 * @throws RangeError naming the id and the counter it exceeded.
 */
export declare function asEntityId(value: number, source: IdSource, label: string): EntityId;
```

**Across a save/load boundary:** the counter is saved *with* the entities, in the same write, and
restored before any id is minted or narrowed. An `IdSource` is JSON-shaped (`{ next: 3417 }`) and
belongs in the game's state next to the ledger. Ids themselves survive as the integers they are;
nothing about them is derived from the session, which is what makes a v1→v2 migration that turns
`lampsLit: number` into `lamps: EntityId[]` writable at all — the migration mints the ids it
needs and writes the counter it left off at.

### 3.10 Determinism: which of this is bit-identical, and which is not

`core`'s two-tier rule applies here more sharply than anywhere else in the kit, because **the
most important arithmetic in the kit is Tier B by default**: `b · r^k` is a `pow`, and the
integrator is a matrix exponential. ECMA-262 specifies `+ - * / %`, `Math.sqrt`, `Math.abs`,
`Math.floor/ceil/round/trunc`, `Math.imul` and the bitwise operators exactly, and explicitly does
not require correctly-rounded `pow`, `exp` or `log`.

Two design moves take almost all of this package back to Tier A:

| symbol | tier | why |
|---|---|---|
| `integrate`, `ratesOf`, `advance`, `advanceOver`, `project` | **A** | `Σ Aᵏx₀tᵏ/k!` needs only `+ − × ÷`. The "matrix exponential" never calls `exp` |
| `buildFlow`, `milestoneMultiplier`, `capacityWall`, `capacityShare`, `capacityLoad` | **A** | multiplication and division |
| `costOfNext`, `bulkCost` | **A** | integer exponent → exponentiation by squaring, not `Math.pow` |
| `solveCrossing` degree ≤ 2 | **A** | `Math.sqrt` is exactly specified |
| `solveCrossing` degree ≥ 3 | **A** | Horner + bisection; the iteration count is fixed, so the result is reproducible |
| `maxBuyable` | **B seed, A decision** | `Math.log` proposes; the Tier A correction loop disposes |
| `offlineCredit`, `offlineElapsed`, `offlineCreditRate` | **B**, or **A** for a dyadic exponent | a fractional power. `0.5`, `0.75`, `0.625` are sqrt chains; `0.6` is not |

What the kit therefore promises, precisely:

- **A replay on the same engine is bit-identical.** Tier B functions are deterministic *within*
  an implementation; the same build on the same device replays exactly, and that is the property
  replay-from-a-log actually needs.
- **Two engines agree to within a few ulps, not to the bit** — and only in the offline warp and
  the `maxBuyable` seed, because everything else is Tier A. A player who moves from Firefox to
  Safari mid-run may see their credited seconds differ in the sixteenth significant figure.
- **Never hash or equality-compare a stock vector.** Not for an integrity check, not for anti-
  cheat, not for a "did this change" test. Compare with a relative tolerance of 1e-9, which is
  what the source game's path-independence tests use and about four orders of magnitude looser
  than the observed error. Routed to `persist`: its checksum must cover the *bytes* of a save, as
  its RFC already specifies, and must never be re-derived from a recomputed state.
- **Server-side verification, if a game ever grows one, recomputes and compares with a
  tolerance.** A verifier that demands equality will reject honest clients on a browser update.
  The one place a tolerance is *not* allowed is affordability: `bulkCost <= budget` is compared
  exactly, and the two-sided `maxBuyable` invariant is what keeps the button and the purchase
  consistent on a given engine. At an exact boundary two engines can differ by one unit bought;
  that is the residual, it is bounded, and papering over it with an epsilon would let a player
  buy something they cannot afford.
- **A persisted price is not portable.** Recompute costs; never store one and compare it later
  for equality.

### 3.11 The export list for `.lattice/kit.json`

Values (31): `VERSION`, `defineEconomy`, `zeroStocks`, `degreeOf`, `createFlow`, `buildFlow`,
`NO_GATES`, `integrate`, `ratesOf`, `elapsedSeconds`, `project`, `advance`, `advanceOver`,
`reanchor`, `expectFiniteStocks`, `solveCrossing`, `solveCrossingOver`, `offlineCredit`,
`offlineElapsed`, `maxOfflineCredit`, `offlineCreditRate`, `capacityWall`, `capacityShare`,
`capacityLoad`, `costOfNext`, `bulkCost`, `maxBuyable`, `milestoneMultiplier`, `createIdSource`,
`mintId`, `asEntityId`.

Types (19): `Stocks`, `StockVec`, `EdgeScale`, `EdgeSpec`, `EconomySpec`, `Edge`, `Economy`,
`Flow`, `GateRatios`, `Ledger`, `Phase`, `CatchUp`, `Crossing`, `OfflineCurve`, `CapacityCurve`,
`CostCurve`, `Milestones`, `EntityId`, `IdSource`.

The `sim` entry's `invariants` array should be replaced with the first four of §5.

---

## 4. What is deliberately absent

**1. A tick.** There is no `step(dt)`, and its absence is the package. A function that steps the
economy N times answers differently at different frame rates and cannot answer "where would this
player be after fourteen hours?" without doing fourteen hours of work. Every routing this RFC
received was a request that could have been satisfied with a tick, and each is answered with an
exactly-located boundary instead.

**2. A clock, and any signature that accepts a delta.** No `Date.now`, no default for `atMs`, and
deliberately **no function taking `dt`** — a builder who wants to pass `loop`'s frame delta will
find nowhere to put it. Enforced by lint, and the reason a test can fast-forward a week with no
timers.

**3. Cycles, and a numerical fallback for them.** `defineEconomy` **refuses**, naming the cycle. I
considered falling back to RK4 and rejected it: (a) a fallback is a *second implementation of the
economy* with different answers, and a game would cross the boundary without noticing, so the two
would diverge silently on exactly the saves that matter most; (b) it breaks the composition
identity — one 14-hour integration equalling 50,400 one-second ones is what makes offline
progress and replay the same code path, and no fixed-step scheme has it; (c) a cycle in an idle
economy is nearly always a design error wearing a mechanic's clothes — "compute buys racks" is a
*purchase*, an action at an instant. Refusing happens at load rather than at hour three, and the
message can name the edge to delete. A friendly fallback that quietly changes what your numbers
mean is not friendlier.

**4. Consuming edges, self-loops, and therefore exponential decay.** An edge subtracts nothing
from its source. A consuming edge puts a negative term on the diagonal, `A` stops being nilpotent,
and the closed form stops terminating. This is the absence I expect to be argued with, because
"hype decays" and "heat dissipates" are real mechanics — the source game hit exactly this and kept
decay *out* of the matrix, integrating `n(t) = n₀e^(−λt)` in isolation because nothing produced
that node, and left a `TODO` saying the first edge *into* it makes them inseparable. Doing it
properly means `exp(At)` for a triangular matrix with repeated eigenvalues: divided differences,
and real numerical care near coincident rates. It is the strongest candidate for v2. Note that a
*linear* drain — the demo's lamps burning oil at a fixed rate per lamp — is **not** this, and is
fully supported: it is a forward edge with a negative `per`.

**5. Clamping.** No caps, no floors, no "a stock may not go negative". A clamp is a nonlinearity,
and one inside `integrate` would be invisible: the function would still return numbers, they
would just no longer be the integral of anything, and I4 would fail by an amount depending on how
often you called it. §3.6 is the alternative and it is strictly better: solve for the instant, put
a boundary there, and the clamp becomes a game event with a time the player can be told about.

**6. Big-number arithmetic — `BigInt`, `Decimal`, layered exponents.** See I14. Nothing,
deliberately.

**7. Randomness.** The economy is a differential equation; there is nothing to seed. `sim` does
not import `Rng`, and a crit chance is the game's, applied at an instant, from the game's stream.
Note the interaction with §3.9: ids come from a counter precisely so that minting one does not
draw from a stream something else is also drawing from.

**8. A schedule generator.** No day/night cycle, no `phaseAt`, no calendar. `sim` consumes
`Phase[]`; it does not know what a day is. A10 budgeted eight lines of game code for this and it
is the right eight lines to write in the game.

**9. An action/commit layer.** The source's best structural idea — *the offline-progress function
and the anti-cheat function are the same function* — lives in its `commit(state, actions, now)`,
and I am not porting it: it requires an action vocabulary and a kit has no business inventing one.
`advance` is the half that generalises.

**10. Formatting.** `4.72M` is `core`'s `format`. Related trap for whoever owns it: `toFixed(0)`
switches to exponential at 1e21 and puts `e+` into a UI string.

**11. Serialization and migration.** `Ledger` and `IdSource` are JSON-shaped by construction and
that is the entire contribution; versioning them is `persist`'s.

**12. A rate breakdown.** "Why is my number what it is" — one line per multiplier with running
totals — is one of the best features in the source game. It is not here because once `buildFlow`
has folded gate × scale × base into one rate the decomposition is gone, and reconstructing it
would mean a second, slower path that could disagree with the first. Named as a gap in §7.

---

## 5. Invariants a reviewer can test

**I1 — the order is proven, not assumed.** For every edge, `eco.index[from] < eco.index[to]`.
*Fails as:* a graph with a backwards edge builds successfully.

**I2 — every cycle is refused at construction,** including a self-loop, with a `RangeError` naming
a node on the cycle.

**I3 — the result is a polynomial of degree `eco.depth`.** Sample `integrate` at
`t = 0…depth+1`; the `(depth+1)`-th finite difference of every node is zero to 1e-9 relative.
*Fails as:* a truncated series, a fixed term count, or small steps.

**I4 — path independence.** `integrate(x, t₁+t₂)` equals `integrate(integrate(x, t₁), t₂)` to 1e-9
relative for fixed flow and gates, including 50,400 s split 600 ways. **And the schedule form:**
`advanceOver` with a phase artificially subdivided into two identical halves returns a
bit-identical ledger to the undivided one.

**I5 — declaration order does not change a single ulp.** Shuffle `spec.edges`; the integrated
result is bit-identical. (Float addition is not associative, so the accumulation order must be
fixed by the package rather than by the game's text file — hence `Economy.edges` sorted.)

**I6 — a gate is exactly a rate multiplier.** Integrating with `gates.grid = 0.5` is
bit-identical to the same graph with that edge's `per` halved and no gate.

**I7 — the warp is applied once, and telescopes.** For any ascending phase list, the sum of the
credited durations `advanceOver` uses equals `offlineCredit(spanSeconds, curve)` exactly, and a
single-phase plan is bit-identical to `advance(…, offlineCredit(span, curve), …)`. *Fails as:*
`W` restarted per phase — the classic way to pay a player K times for one absence.

**I8 — phases past the horizon are free and harmless.** Appending phases beyond
`curve.flatAfterSeconds` changes no stock by more than 0 ulps, and doubling `spanSeconds` past the
horizon changes nothing at all.

**I9 — a crossing is a crossing.** For any `t = solveCrossing(…, node, level, h)` with
`t < Infinity`: integrating exactly `t` puts `node` within 1e-9 relative of `level`, and no
sample in `[0, t)` is on the far side of it (it is the *first*). Test degree 1 and 2 against the
algebraic answer, degree 3 against a polynomial with three planted roots (the earliest must be
returned), and a dipping-then-recovering stock (the dip must be reported).

**I10 — a crossing costs the same at any horizon.** The iteration count of `solveCrossing` for a
one-second horizon and a fourteen-hour horizon is identical. *Fails as:* anything that walks time.

**I11 — both clocks agree.** For a `Crossing`, `offlineCredit(atSeconds, curve)` equals
`creditedSeconds` to 1e-9, and with no curve the two are equal exactly.

**I12 — the capacity pair.** `capacityWall(s, s, c) === 1` exactly; `capacityWall(s, s·blackoutAt,
c) === 0`; strictly decreasing between; `capacityWall(0, d>0, c) === 0`. `capacityShare(s, d)` is
`1` for `d <= s` and `s/d` above, never `0` for finite positive `s`. Neither ever returns `NaN`.

**I13 — `maxBuyable` is two-sided.** With `n = maxBuyable(c, k, budget, cap)`:
`bulkCost(c, k, n) <= budget` and `bulkCost(c, k, n+1) > budget` unless `n === cap`. Sweep
`budget` across the exact boundaries `bulkCost(c, k, m)` for `m` in 0…200.

**I14 — `bulkCost` matches a naive loop** to 1e-9 relative for `n` up to 200. The loop is the
oracle; it is only ever allowed in a test.

**I15 — the offline curve is continuous, monotone and never generous.** `W(U) === U` exactly;
`|W(U+ε) − U| < 1e-6`; non-decreasing; `W(T) <= T` for all `T`; `W(T) === W(F)` for every `T > F`
(clamp the *input*, so 48 h and 72 h return the identical value 24 h returns rather than
approaching it — coming back later must never pay more). And `offlineElapsed(offlineCredit(t)) === t`
to 1e-9 for `t <= F`.

**I16 — Tier A means bit-identical.** Every symbol marked A in §3.10 produces byte-identical
output in Node, in Chrome and in Firefox over a fixture of 10,000 inputs, and a grep for
`Math.pow`, `Math.exp`, `Math.log`, `**` or any trigonometric function in `packages/sim/src`
returns only `maxBuyable`'s seed and `offlineCredit`'s non-dyadic branch.

**I17 — a dyadic exponent is exact.** `offlineCredit` with `exponent: 0.5` equals
`U * Math.sqrt(T/U)` bit-for-bit, and with `0.75` equals the corresponding sqrt chain. For any
exponent, the result is within 2 ulps of `U * (T/U) ** e`.

**I18 — ids are monotone, never reused, and save-checked.** 10,000 mints are strictly increasing
with no repeats; `asEntityId(source.next, source, …)` throws; a round trip through
`JSON.parse(JSON.stringify(...))` of the source and its entities re-narrows every id.

**I19 — time never runs backwards into resources, and never runs away with them.** `project`,
`advance` and `advanceOver` with an `atMs` earlier than the anchor credit exactly zero, destroy
nothing, and **do not move the anchor**; only `reanchor` moves it backwards. A gap of one year
credits exactly `maxOfflineCredit(curve)` — identical to the credit for a gap of 24 h, to the bit
— and `advanceOver` with a curve visits no phase beginning at or after `flatAfterSeconds`
(assert by counting visits with an instrumented phase list of 100,000 entries).

**I20 — a save can hold every number this package produces.** `advance` and `advanceOver` throw a
`RangeError` naming the node when any resulting stock is not finite; `expectFiniteStocks` rejects
a vector containing `null`, `NaN` or `Infinity` from a round trip through
`JSON.parse(JSON.stringify(...))`. *Fails as:* a stock that saved cleanly and loaded as `null`.

**I21 — the hot path allocates nothing.** 100,000 `project` calls show no heap growth and no GC
pause above the frame budget; `project`, `integrate`, `ratesOf` and `buildFlow` each return the
`out` object they were handed.

**I22 — no delta anywhere.** No exported function takes a duration as its notion of "now"; every
one that moves the anchor takes a required `atMs`. *Fails as:* the first `advanceBy(seconds)`
convenience someone adds.

**I23 — floating point, stated as a boundary rather than a defense.**

A `double` holds every integer exactly up to `2^53` (9,007,199,254,740,992;
`Number.MAX_SAFE_INTEGER` is one below). Past that the spacing is 2, then 4, then 128 by `2^60`,
and about 131,072 by 1e21. Relative precision never degrades — every result is within half an
ulp, so a cost of 1e300 is still good to fifteen significant figures — so **the magnitude is fine
and the integers are not.** Two places it bites, and only two:

- **Spending becomes free.** With a balance of 1e17 and a cost of 3, `balance - cost === balance`.
  The player buys forever. This is the actual bug; every other symptom is cosmetic.
- **Costs saturate.** At `growth = 1.07`, `costOfNext` crosses `2^53` at about 520 owned and
  reaches `Infinity` at about 10,500. The first is reachable in a long session; the second by a
  save left alone for a week.

**What the kit does about it: nothing, deliberately.** No `BigInt`, no `Decimal`, no
mantissa/exponent pair. Four reasons: (a) it would infect every signature in the kit — `iso`,
`draw` and `ui` all take `number`, and a game would spend its life converting at boundaries;
(b) every arbitrary-precision type allocates per operation, which loses non-negotiable #7 on the
hot path this package exists to protect; (c) 12 KB gzipped per package, and a bignum library is
most of that budget alone; (d) determinism — IEEE-754 doubles are bit-identical across platforms
by specification, and a software bignum is only as reproducible as its own rounding code, which
after §3.10 would be the *least* reproducible thing in the package.

What it does instead, and what a reviewer should check: `bulkCost` returns `Infinity` on overflow
rather than a wrapped or negative number, so an unaffordable purchase is *refused*, never silently
free; `maxBuyable` is clamped by `cap`; `integrate` throws on non-finite `seconds` rather than
writing `NaN` into a save. And the design answer, which is the real one: **a game whose numbers
approach 9e15 has a prestige problem, not an arithmetic problem** — and if it has deliberately
refused prestige, as the demo has, then it has an *ending*, which solves the same equation from
the other side. If a game genuinely needs to run past it, that is a new package and a deliberate
decision, not a silent upgrade of every `number` in the kit.

---

## 6. The traps

**T1 — the buy loop.** 4,000 `Math.pow` calls per frame to render a *label*. Closed form on day one.

**T2 — off-by-one in `maxBuyable`, both directions.** `Math.log` and `**` are accurate to an ulp
or two, so the analytic answer lands on the right integer *or one either side*. Bounded
correction, two-sided assertion — not a search, and not a fudge factor.

**T3 — partial spends.** A fixed batch is all-or-nothing: ×10 with funds for six buys nothing, not
six. Only `max` resolves against the balance.

**T4 — milestones on effective counts.** The subtlest bug in the package. A multiplier keyed on a
count the flow produces changes the rate *inside* the integral, and a client integrating at 10 Hz
places the discontinuity somewhere different from a catch-up integrating once: same save, two
answers, neither reproducible.

**T5 — scaling yield instead of time for offline.** A dupe with a plausible formula. Warp the
clock, not the output.

**T6 — the two offline near-misses.** `W(T) = U + T^e` drops the `U^(1−e)` normalization and jumps
by `U^e` at the knot — about 259 credited seconds at the shipping numbers — so returning at
3h00m01s pays more than at 2h59m59s: a visible, farmable step. `W(T) = U + (T−U)^e` is continuous
and wrong more subtly: its slope at `U⁺` is *infinite* because `e < 1`, so for the first seconds
past the knot the player earns faster than live and closing the tab at 2h59m becomes optimal play.
A softcap that opens by paying a bonus is not a softcap.

**T7 — restarting the warp per phase.** The schedule version of T6 and the one I expect a builder
to get wrong: `offlineCredit(b − a)` per phase instead of `W(b) − W(a)`. It pays a player K times
over for one absence, it is *invisible* for short gaps because `W` is the identity below `U`, and
it grows without bound with the length of the absence. I7 is the test.

**T8 — folding a projection back into the anchor.** `project` at 10 Hz then storing the result
gives a state that is correct and not reproducible: it now depends on frame rate. Move the anchor
only where a replay would.

**T9 — crediting a backwards clock.** Laptop suspends, NTP corrections and a user changing their
system date all produce `atMs < ledger.atMs`. Zero, never negative, never `Math.abs`.

**T10 — the brownout as a tax.** A floor on the ratio. A bot ignored a 136/20 over-draw for forty
minutes because it could.

**T11 — gating the generator.** If the edges that *produce* the gated capacity are throttled by
it, a total blackout is unrecoverable and the save is dead. Untag supply-side edges.

**T12 — counting buildings that are not finished.** A substation under construction that already
draws browns out the campus for the forty-five seconds before it helps. That is the game's
supply/demand calculation, and it is the first thing to check when a brownout looks like a bug.

**T13 — forgetting `buildFlow` after a gate changes.** Rates are cached in the `Flow`. Rebuild
whenever *anything* feeding a rate moved; it is one pass over tens of edges.

**T14 — sharing one `Flow` between two worlds.** It carries the integrator's and the root-finder's
scratch. Two concurrent advances interleave their intermediate terms and produce garbage that is
not obviously garbage.

**T15 — clamping inside `integrate`.** The function stops being an integral and I4 fails by an
amount depending on how often you called it. Solve for the crossing and put a boundary there.

**T16 — `!` on an indexed lookup.** Under `noUncheckedIndexedAccess`, `eco.order[i]` is
`N | undefined` and the tempting fix is `!`. In the source game exactly this shipped a black screen
to two of four biomes: the type was the bug report.

**T17 — summing `dt`.** `loop`'s frame delta is clamped and dropped, and `loop.time` runs at about
a quarter speed in a hidden tab. An economy built on it deletes precisely the time the player was
away, and it cannot be reproduced in the foreground, which makes it the most expensive kind of bug.

**T18 — passing `loop.time` where an epoch is wanted.** The same disaster with the right units. It
type-checks today (§7 asks `core` to fix that) and the symptom is an offline gap of fifty-six
years on the first load, or four times too little on every subsequent one.

**T19 — using `SaveEnvelope.t` as the accrual anchor.** Short by the debounce interval, every
session, silently.

**T20 — reporting a crossing in the wrong clock.** "3:41 into the second night" is *real* time;
the solve happens in *credited* time. Under a warp they differ by a factor that grows with the
absence, so a toast built from the credited number is confidently wrong about the player's own
evening. `Crossing` carries both so that neither has to be derived at the call site.

**T21 — the standing-charge exploit, which is a design finding and belongs to A10.** A warp that
shrinks credited time shrinks *costs* as well as income. A game whose night is a standing charge
therefore rewards the player for closing the tab during it: they skip most of the oil bill and
most of the darkness. Nothing is minted — burn and income shrink together — so this is not a dupe,
but it is an incentive pointing exactly away from the intended play. Three ways out, and the
choice is the designer's, not mine: accept it (fine if the night also earns); make the night's
punishment *state* rather than *flow* (lamps go out and stay out, which a crossing gives you
exactly); or ensure the credited night is never large enough to matter. Related and worth checking
before `D1`: with a 24-hour flat knot, **an absence longer than the horizon credits nothing past
it**, so "the second night" must fall inside the credited window for the demo's own toast to be
writable. At 45 s days and `15 + 9d` nights it does, comfortably — but the toast's copy should be
derived from the crossing, never assumed.

**T22 — the forward clock jump, and the freeze that follows it.** The obvious failure is
over-crediting, and the curve already prevents it. The one that actually ships is the *second*
half: the anchor lands a year ahead, the user fixes their date, and from then on every read sees
time running backwards and credits zero — a game that has silently stopped, with no error and a
save that looks fine. Detect a backwards gap larger than a plausible NTP correction and
`reanchor`. A test for this is two lines and nobody writes it.

**T23 — `curve: null` at a hydrate seam.** The upper clamp only exists if the curve is passed.
The field is required-and-nullable precisely so this is a visible decision, and `null` on the
load path means a device clock jump finishes the game.

**T24 — `Infinity` in a save.** It serializes to `null`, checksums cleanly, and loads as a hole.
Never persist a derived read that can be infinite (`capacityLoad` is the one in this surface), and
run `expectFiniteStocks` on anything that came out of `JSON.parse`. The upstream cause is nearly
always a balance with no sink, compounding across sessions rather than within one.

**T25 — polynomial conditioning at degree ≥ 3.** Root-finding from coefficients is
ill-conditioned for high degree and closely-spaced roots. Evaluate by Horner, bisect on sign, and
do not "improve" it with a Newton step from an arbitrary start — Newton is what turns a
deterministic 60 iterations into a platform-dependent answer.

---

## 7. Routings — gaps and requests that belong to other packages

**To `@lattice/core` (two, one of them blocking a seam):**

1. **Take `EpochMillis`, and consider branding it.** `loop`'s routed note 5 already asks for
   `export type EpochMillis = number; export type Now = () => EpochMillis;`. I need it and cannot
   declare it: `persist` and `sim` are siblings, so a type declared in either is invisible to the
   other and two structurally-identical brands would be incompatible anyway. **`core` is the only
   possible home.** Beyond the alias, I would take a branded version with a checked constructor —
   `epochMillis(ms: number): EpochMillis` using `guard` — because T18 (passing `loop.time` where an
   epoch is wanted) is the most damaging substitution available in the kit and is invisible to a
   plain `number`. If core takes the brand, `loop.time` must *not* be branded with it.
2. **Adopted with thanks:** `guard`'s return-the-value shape is what lets `defineEconomy` name the
   offending node, and the Tier A/B rule is now the spine of §3.10. No objection to either.

**To `@lattice/persist`:**

3. **`SaveEnvelope.t` is not the accrual anchor** and should say so in its own doc. The number
   offline progress reads is `ledger.atMs`, stored verbatim inside the payload, never re-stamped
   at write time. `elapsedSince` is right for staleness and wrong for earnings, by exactly the
   debounce interval (§3.3, T19).
4. **Never checksum a recomputed state.** The integrity check must cover the bytes read, which its
   RFC already specifies — the risk is a later "improvement" that hashes a parsed-and-recomputed
   vector, which after §3.10 is a float comparison across engines and will fail over nothing.
5. **A migration that mints ids needs the counter in the same version bump.** The demo's
   v1 `lampsLit: number` → v2 `lamps: EntityId[]` migration must write `IdSource.next` too, or the
   next mint collides with a lamp it just created.
6. **The upper clamp is accepted and it is `maxOfflineCredit(curve)`** — see §3.4. Leaving
   `elapsedSince` unclamped from above is the right call: a raw gap is what a game needs to *say*
   something about a bad device clock, and capping it in `persist` would have hidden the
   information from the only layer that can judge it. The clamp lands on the credit, not the gap.
7. **`sim` will throw on a non-finite vector at a boundary call**, which is designed to arrive at
   `persist`'s "corrupt save → fresh, with a reported reason" path rather than at a player. If
   that path only catches parse and checksum failures today, it should also catch a `RangeError`
   from state validation, or the two of us have built half a pipeline each.

**To `@lattice/loop`:** ratified as written, with one nit — `persist`'s §4.8 says "`loop` owns the
clock", which predates `loop`'s refusal of the epoch. Both agree the *caller* passes the number;
the orchestrator may want persist's wording aligned to "the game owns the calendar".

**To the demo (A10):**

6. **T21 is a design finding, not an implementation detail**, and it is the one thing in this RFC I
   would want answered before `D1`.
7. **`sim` can now serve both of your ✗ rows**: alternating piecewise rates (§3.5) and
   closed-form depletion time (§3.6, exact at degree 1 — which oil is, since presses and lamps are
   counts, not products of the flow). The pilgrim clamp is `capacityShare`, the oil gate is
   `capacityWall`, and nightfall is a gate ratio of 0 or 1. What I need from you in return is the
   `Phase[]` generator, which is yours by §4 item 8.

**Unowned, and it should be somebody's:** the rate breakdown (§4.12) — one line per multiplier
with a running total, so a player who cannot see why a number moved can still make a decision
about it. It wants to live where the multipliers are still separate, which is the game; if the
demo writes it twice, it is a `ui` primitive.
