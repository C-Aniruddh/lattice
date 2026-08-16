# Rates that are not linear in a stock — and the one that is not linear in anything

> **Status:** decided at `K6`.
> **Decision, in three parts:**
> 1. **The linear-producer constraint stays, and it is not a limitation — it is the product.**
>    `EdgeScale` is not an escape hatch; it is the sanctioned, documented, only way to spell a
>    square-root, threshold or milestone rate, and `sim`'s prose should say so at the top rather
>    than in a type alias halfway down.
> 2. **Square-root rates were never the problem.** The exhibit's `pilgrims(reach) · k · √reach`
>    goes through `EdgeScale` correctly and is fully supported. This half is a **documentation**
>    answer and it is stated as one.
> 3. **The division is the tell, and it points at a real, small, missing thing: `sim` has no
>    source edge.** One optional field on `EdgeSpec`. This half is an **API** answer.

---

## The one sentence

**`sim` is linear between commits because nilpotency is what makes fourteen hours cost the same
as one second — so a rate may be any function you like of things the player changed, and may
never be a function of a stock this graph produces.**

That sentence is the whole constraint, and the exhibit obeyed it. What the exhibit could not
express was something else entirely.

## The five-line example — what a game should be able to write

```ts
const eco = defineEconomy<'lamps' | 'coin', 'night'>({
  nodes: ['lamps', 'coin'],
  gates: ['night'],
  edges: [
    { to: 'coin', per: 1, gate: 'night', scale: () => coinRate(reach) },   // ← no `from`
    { from: 'lamps', to: 'coin', per: 0.5 },                               // a plain producer
  ],
});
```

The first edge is a **source**: `d(coin)/dt += per × scale × gate`, with nothing multiplying it.
It is the single line the first exhibit could not write, and the workaround it wrote instead is
the evidence for the rest of this document.

---

## The evidence

`examples/demo/src/rules.ts`, the exhibit's entire economy:

```ts
const eco = defineEconomy<Node, Gate>({
  nodes: ['lit', 'coin'],
  gates: ['night'],
  // The one place the kit made this game divide: `coin` is not linear in anything the graph
  // holds, so the whole rate goes through one edge's scale and is divided back out per lamp.
  edges: [{ from: 'lit', to: 'coin', per: 1, scale: (s) => (s.lit > 0 ? coinRate(reach) / s.lit : 0) }],
});
```

with

```ts
export function coinRate(reach: Reach): number {
  const px = reach.run * SPACING;
  return px <= 0 ? 0 : pilgrims(reach) * COIN_K * Math.sqrt(px);
}
```

It works. It stays Tier A (`Math.sqrt` is Tier A; `capacityShare` inside `pilgrims` is arithmetic).
It is closed form, one integration answers for a frame or an hour, and none of `sim`'s guarantees
were bent. **And it contains a division whose only purpose is to cancel a multiplication the API
insisted on**, plus a `s.lit > 0` guard whose only purpose is to stop that division being `0/0`.

There are two independent tells in those four lines and they say different things.

### Tell one: the division cancels `× stock(from)`

Every edge is `d(to)/dt += per × scale × gate × stock(from)`. The exhibit wanted
`d(coin)/dt = coinRate(reach)` — a rate that multiplies nothing. The only way to get one is to
pick a `from`, then divide by it. That is not an idiom; it is a workaround for a missing case.

### Tell two — the worse one: `lit` is a node in the save purely to be a multiplicand

`lit` is a stock. It is in `EconomySpec.nodes`, which is *the save's field order*. Nothing in the
economy produces it — there is no edge with `to: 'lit'` — and the game assigns it by hand
(`ledger = { stocks: { ...ledger.stocks, lit: litSet.size }, atMs: ledger.atMs }`). Its entire
reason for existing in the persisted economy is to be the thing the division divides out.

**A save file has a field in it because the API had no way to say "this rate multiplies
nothing".** That is the finding, and it is a save-format consequence, not an ergonomic one.

---

## Part 1 — is the linear-producer shape right for an idle-economy package?

**Yes, and it should be argued for at the top of the package rather than defended when someone
notices.** The argument is not aesthetic and it is not "linear algebra is tidy". It is this:

`graph` guarantees edges point strictly forward, so `A` in `dx/dt = A·x` is strictly triangular
and therefore **nilpotent**: `A^(depth+1) = 0`. The exponential is then a *terminating polynomial*
of degree `eco.depth`, evaluated in `+ − × ÷` only — Tier A, bit-identical, safe to persist.
That is the single fact from which every other claim in the package descends:

| the claim | what it rests on |
|---|---|
| one fourteen-hour integration = fifty thousand one-second steps | the polynomial terminates and the flow map composes |
| offline accrual is arithmetic, not replay | same |
| a save's numbers are identical on every engine | Tier A throughout, no `exp` |
| there is no step size to get wrong and no stiffness | there is no integrator |

**Introduce one term that is nonlinear in a stock and every row of that table becomes false at
once.** `d(coin)/dt = k·√coin` has a closed form, but not a *terminating polynomial* one, and it
does not compose with the rest of the vector; the honest implementation is a numeric integrator,
at which point fourteen hours costs fifty thousand steps, the answer depends on how often you
asked, and `sim`'s one sentence is a lie. There is no version of this that is a small concession.

### But idle games do have square-root and threshold rates — so what happens to them?

**Nothing. They were never the excluded case, and this is the sentence the docs are missing.**

Look at what those rates are actually functions of:

| a real idle-game rate | function of | legal today? |
|---|---|---|
| "every 10th press doubles all presses" | *purchased count* | yes — `scale: () => milestoneMultiplier(bought, MILESTONES)` |
| "output scales with √(prestige points)" | *a banked, player-facing total* | yes — `scale: () => Math.sqrt(prestige)` |
| "producers above 100 get a 3× bonus" | *purchased count* | yes — a threshold inside `scale` |
| "coin scales with how far the road reaches" | *a length the player extends by tapping* | yes — the exhibit's own edge |
| "output ∝ √(coin you currently hold)" | **a stock this graph produces** | **no, and it must stay no** |

Only the last row is refused, and the last row is the one that is genuinely pathological: it is a
rate discontinuity *inside* an integral, so the same save answers differently at 10 Hz than after
one catch-up. `EdgeScale`'s doc comment already says this, precisely and well:

> **Key it on a quantity that only changes when the player acts.** … Purchased counts change only
> at actions. Effective counts change continuously. Use the first.

**So the constraint is not "rates must be linear". It is "rates must be *piecewise constant in
time*, with the pieces bounded by player actions and gate flips."** Square roots, thresholds,
capacity shares, milestone multipliers, day/night, and anything else a designer wants are all
inside that. `EdgeScale` is exactly the door, `buildFlow` is the commit that closes the piece,
and the whole thing is one boundary-versus-tick argument the package already makes elsewhere.

**Documentation actions** (all in `packages/sim`, outside `K6`'s paths — see *Routed findings*):

- **`src/index.ts` header.** Add the rule beside "everything in `sim` is linear between commits":
  > **A rate may be any expression you like — `√`, thresholds, milestones, capacity shares — as
  > long as it is *piecewise constant in time*. `EdgeScale` is where those expressions go, and it
  > is the sanctioned way to write them, not a workaround. Rebuild with `buildFlow` at every
  > boundary. The one rate `sim` refuses is one that reads a stock this graph produces, because
  > that is a discontinuity inside an integral and it makes the same save answer two ways.**
- **`README.md`.** The five-line example currently shows a plain producer. Show a `scale` with a
  `Math.sqrt` in it, because a reader who does not see one assumes it is unsupported — which is
  what the first exhibit's author concluded, from a doc comment that said otherwise.
- **`EdgeScale`'s doc comment** is already the best paragraph on this in the repo. It is in the
  wrong place: a reader finds it after they have already decided the package cannot do what they
  want. Promote its argument to the module header and leave the detail where it is.

**On this half, the honest answer is: no API change, and `sim` was right.** The gap is that the
package's front door reads as *linear producers only* and its correct, general answer is four
screens in.

---

## Part 2 — the source edge, which is a real gap

### What is missing

An edge whose rate multiplies nothing: `d(to)/dt += per × scale × gate`. Every idle economy has
at least one — the tick income, the base drip, the thing that pays while you own zero of
everything, and, here, a headline rate that is a property of the *world* rather than of a
countable stock.

### The proposal

One field, made optional.

```ts
export interface EdgeSpec<N extends string, G extends string> {
  /**
   * The producing stock. **Omit for a source** — an edge with no `from` adds
   * `per × scale × gate` to `to` per second, multiplying nothing.
   *
   * A source is what an idle economy's headline rate usually is: "the road earns k·√reach",
   * "the colony produces 3/s". Without one, a game must nominate an arbitrary `from`, divide the
   * rate back out by it in `scale`, and guard the zero — and it must keep that node in
   * `EconomySpec.nodes`, which is the save's field order, so the workaround reaches the save
   * file. The first exhibit built on this kit did all four.
   */
  readonly from?: N;
  readonly to: N;
  readonly per: number;
  readonly gate?: G;
  readonly scale?: EdgeScale<N>;
}
```

### Why this is safe, in one paragraph

A source is an affine term, and the affine term is the *same object* as a node pinned to 1:
`b = A·e` where `e` is a hidden unit node with no incoming edges. Because nothing produces it,
it sorts first in Kahn order and `A` stays strictly triangular and therefore nilpotent. The
integrator's inner loop is already `acc[to] += rate × x[from]`; the implementation is a reserved
slot in the workspace holding `1`, and `Edge.from` resolving to its index. **Degree rises by one
along source-fed chains, which `Economy.depth` already computes from the edges** — no new bound,
no new loop, no `exp`, still Tier A, and the polynomial still terminates. `d/dt` of a source into
a chain of depth `d` is a polynomial of degree `d + 1`; that is the entire mathematical
consequence.

### The zero-cost alternative, and why it is worse

A game can do this today with a **unit node**: declare `'one'` in `nodes`, hold it at `1`, and
write `{ from: 'one', to: 'coin', per: 1, scale: … }`. No division, no guard, no API change.

It is a real option and should be documented as the workaround for anyone on `0.1.0`. It is not
the answer, for one reason: **`zeroStocks(eco)` sets it to `0`, and then the entire economy
silently produces nothing.** `zeroStocks` is the function every game calls to make a projection
target and a new save — the exhibit calls it — so the workaround's failure mode is *an economy
that stops earning after a fresh start, with no error and nothing to grep for*. This repo's whole
posture is against exactly that shape of bug. A convention whose forgetting is silent is not a
convention; it is a trap with documentation.

### The invariants a reviewer can test

| # | invariant | fails as |
|---|---|---|
| S1 | `{ to: 'coin', per: 3 }` integrated for `t` seconds from zero stocks yields `coin === 3t`, exactly, for `t` in `[0, 1e6]`. | The source term is dropped or double-counted. |
| S2 | A source into `a`, with `a → b`, integrated for `t`, gives `b` a `t²/2` term. `Economy.depth` for that graph is `2`, not `1`. | The nilpotency bound was not raised and `b` is truncated to zero — silently, since a shorter polynomial is still a valid-looking number. |
| S3 | `integrate(t₁ + t₂)` and `integrate(t₁)` then `integrate(t₂)` agree to 1e-9 relative **with sources present**. | The affine term does not compose, and one catch-up disagrees with fifty thousand steps — the one identity the package exists to preserve. |
| S4 | A source edge is accepted with no `gates` declared, and a source edge naming an undeclared gate is refused by name. | Gate validation keyed on `from` rather than on the edge. |
| S5 | `defineEconomy` refuses `{ per: 3 }` with no `to`, by name. | `to` is not optional and never becomes so. |
| S6 | `degreeOf` and the Kahn order are unchanged for a spec containing no source edges — byte-identical `Economy.order` and `Economy.edges` for every existing test. | A source-aware sort reordered an existing graph, which moves the last bit of every stock in every existing save. |
| S7 | The reserved unit slot is not addressable from `Stocks<N>` — a game with `nodes: ['coin']` has a save with exactly one field. | The hidden node leaked into the save format, which is the workaround this replaces. |

### Traps for whoever implements it

1. **`Edge.from` is `N` today and load-bearing in the sort, the error messages and `Flow.edgeFrom`.**
   Widening it to `N | undefined` in the *public* `EdgeSpec` while keeping the *validated* `Edge`
   total (pointing at the reserved slot) is the shape that keeps every internal loop branch-free.
   A branch on `undefined` in `integrate` is a branch in the hottest loop in the package.
2. **`Economy.depth` must count source edges.** S2 is the test and its failure is silent — a
   truncated polynomial is a plausible number.
3. **The error message for a source edge must not say `undefined → coin`.** It should say
   `source → coin`, or a designer greps their spec for a node they never wrote.
4. **`buildFlow` still evaluates a source's `scale` with the stock vector.** That is correct and
   should be documented: a source's rate is frequently a function of a purchased count, which is
   exactly what the exhibit's `coinRate(reach)` is.
5. **Do not let a source edge into `solveCrossingOver`'s root finder without a test.** A constant
   term changes the polynomial's degree and therefore its root structure; a depletion solve that
   assumed the lowest-order term was linear will find the wrong crossing.

---

## What is deliberately absent

- **Consuming edges.** Still refused, still for the reason `EdgeSpec` gives: a negative diagonal
  term breaks nilpotency. A linear drain remains a forward edge with a negative `per`, and a
  **negative source** is now the honest way to spell a flat standing charge.
- **Any nonlinearity in a stock.** Part 1. Not negotiable, and the reason should be quotable.
- **A per-edge time warp.** `docs/rfc/demo.md` §1 already killed this: a node cannot be integrated
  on two clocks and it is not one ledger. Nothing here reopens it.
- **A comparator, a solver plug-in, or a user-supplied `f(x)`.** Any of the three turns `sim` into
  a general ODE integrator, which is a different package with none of this one's guarantees.
- **Warning when a `scale` reads a produced stock.** Tempting, and undecidable: `scale` is an
  opaque closure. The mitigation is documentation plus one invariant a *game's* suite can hold —
  integrate `T` once and integrate `T` in a thousand pieces, and assert they agree. **That test
  belongs in every game's suite and should be in the `lattice-economy` skill**, because it is the
  only thing that catches this class at all.

---

## Routed findings — outside `K6`'s paths

1. **`packages/sim/src/graph.ts`, `flow.ts`, `index.ts`, `README.md`** — Part 1's documentation
   changes and Part 2's `from?: N`. Both belong to whoever holds `sim` next; Part 1 is free and
   should not wait for Part 2.
2. **`examples/demo/src/rules.ts`** — once `from?` lands, the edge becomes
   `{ to: 'coin', per: 1, gate: 'night', scale: () => coinRate(reach) }`, the guard and the
   division both go, and **`lit` leaves `nodes` entirely** — the exhibit's economy drops to a
   single node. That diff is the acceptance test for this RFC. Owner: whoever holds the exhibit
   after `K3`/`K5`.
3. **`.lattice/kit.json`** — `EdgeSpec.from` becoming optional is a surface change and the
   manifest must follow.
4. **The `lattice-economy` skill (`S4`)** — should lead with Part 1's rule, show a `√` rate in its
   first example, and ship the compose-identity test named above as the thing a game writes once.
5. **`docs/GUIDE.md`** — its economy section shows plain producers only, and a reader who wants a
   square root will not learn from it that they already have one.
