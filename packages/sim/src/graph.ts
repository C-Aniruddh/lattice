/**
 * Declaring a production graph, and proving it has a closed form.
 *
 * This is the module the source game did not have. It hard-coded a resource enum and a
 * *hand-maintained* topological array, and asserted the two agreed. That works for one game
 * with fourteen resources and one author; it does not survive a second content update, and it
 * cannot be asked of a kit's users at all. So the order here is **computed by Kahn's algorithm
 * and therefore proven**, and the graphs that have no order are refused by name.
 *
 * Two orders live in this file and they are deliberately different things:
 *
 * | order | who decides | what it controls |
 * |---|---|---|
 * | {@link EconomySpec.nodes} — *storage* | the game, by declaration | the field order a save writes. Append-only |
 * | {@link Economy.order} — *evaluation* | this module, by Kahn | which producer is applied before which consumer |
 *
 * Keeping them apart is what lets a v4 node be appended to `nodes` without moving a single
 * field of a v1 save, while the evaluation order it belongs in is recomputed from the edges.
 * Conflating them — which is what a single hand-maintained array does — means inserting a node
 * in the middle of a chain silently renames every field after it.
 *
 * There is a **third** node, and the reason it is worth a paragraph here is that it is in neither
 * order. An {@link EdgeSpec} with no `from` is a *source*, and a source is an affine term that
 * this module represents as a hidden node pinned to `1`. It is not declared, it cannot be named,
 * it is not in `nodes` and so it is not in any save — it is one reserved element at the end of the
 * integrator's workspace, addressed through {@link Edge.fromIndex}. The distinction is the whole
 * value of the feature: a game that spells a source by declaring a real node and holding it at `1`
 * has put a field in its save format, and `zeroStocks` will set that field to `0` on the next
 * fresh start and silently stop the economy.
 *
 * Isomorphic and Tier A: nothing here reads a clock, a random source or a platform, and every
 * arithmetic operation is comparison and integer addition.
 */

import { expectFinite, expectNonEmpty, expectObject } from '@latticekit/core';

/** A stock vector, keyed by node id. Plain JSON: this is what `@latticekit/persist` writes. */
export type Stocks<N extends string> = Readonly<Record<N, number>>;

/** The mutable form. Every hot-path function writes into one of these instead of allocating. */
export type StockVec<N extends string> = Record<N, number>;

/**
 * A per-edge multiplier, evaluated **once per `buildFlow`** and held constant across the
 * integration that follows.
 *
 * **This is where a rate that is not linear stops being a problem.** Because the factor is
 * sampled once and frozen, the expression inside it may be anything at all — a square root, a
 * threshold, a milestone table, a capacity share, a curve read off a design spreadsheet. The
 * constraint `sim` actually imposes is not *linear*, it is **piecewise constant in time**, and
 * every one of those is constant between commits. The milestone mechanic ("every tenth press
 * doubles what all of them make") is this, in one line:
 * `scale: () => milestoneMultiplier(game.pressesBought, MILESTONES)`; a prestige bonus is
 * `scale: () => Math.sqrt(game.prestige)`. Neither is a workaround, and neither costs the closed
 * form anything.
 *
 * **Key it on a quantity that only changes when the player acts.** It receives the stock vector
 * at the anchor because that is often where the count lives, and that is also the trap: keying
 * a milestone on an *effective* count that the flow itself produces puts a rate discontinuity
 * inside an integral, and the same save then answers differently at 10 Hz than it does after
 * one fourteen-hour catch-up. Purchased counts change only at actions. Effective counts change
 * continuously. Use the first.
 *
 * A **source** edge's `scale` is evaluated with the stock vector exactly like any other, which is
 * usually what you want: a headline rate is most often a function of something the player bought.
 */
export type EdgeScale<N extends string> = (stocks: Stocks<N>) => number;

/**
 * One production edge: `d(to)/dt += rate × stock(from)`, or — with no `from` — `d(to)/dt += rate`.
 *
 * **Non-consuming.** The edge adds to `to` and subtracts nothing from `from`; a consuming edge
 * would put a negative term on the diagonal, `A` would stop being nilpotent, and the closed
 * form would stop terminating. A *linear drain* — lamps burning oil at a fixed rate per lamp —
 * is not that, and is fully supported: it is a forward edge with a negative `per`. A flat
 * standing charge is a **source with a negative `per`**.
 */
export interface EdgeSpec<N extends string, G extends string> {
  /**
   * The producing stock. **Omit it for a source** — an edge with no `from` adds
   * `per × scale × gate` to `to` every second, multiplying nothing.
   *
   * A source is what an idle economy's headline rate usually is: the tick income, the base drip,
   * the thing that pays while the player owns zero of everything, and any rate that is a property
   * of the *world* rather than of a countable stock — "the road earns `k·√reach`", "the colony
   * produces 3/s".
   *
   * **Without it a game must nominate an arbitrary `from` and divide the rate back out by it**,
   * guard the zero case so the division is not `0/0`, and keep that node in
   * {@link EconomySpec.nodes} — *which is the save's field order*. The workaround therefore
   * reaches the save file: a persisted field whose only reason to exist is to be a multiplicand.
   * The first game built on this kit did exactly that, and it is why this field is optional.
   *
   * A `from` that is present but is not a declared node id is still a mistake and is still
   * reported as one; only *absence* means source.
   */
  readonly from?: N;
  readonly to: N;
  /**
   * Units of `to` per unit of `from` per second, before `scale` and before the gate — or, on a
   * source, units of `to` per second outright.
   */
  readonly per: number;
  /** The capacity that throttles this edge, if any. An untagged edge is never throttled. */
  readonly gate?: G;
  readonly scale?: EdgeScale<N>;
}

/**
 * Everything a game declares about its economy. Structure only: no balance, no time, no state.
 *
 * Getting `nodes` wrong is a save-compatibility bug rather than a maths bug, which is why it is
 * documented at the field rather than here.
 */
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

/**
 * A validated edge, in the package's own order.
 *
 * The difference from {@link EdgeSpec} is `slot` and the ordering of the array it lives in: a
 * game's spec file is text a designer reorders freely, and float addition is not associative,
 * so the accumulation order has to be fixed here or a cosmetic diff moves the last bit of every
 * stock in the game.
 */
export interface Edge<N extends string, G extends string> {
  /** `undefined` on a source. Present for diagnostics; the arithmetic reads `fromIndex`. */
  readonly from: N | undefined;
  readonly to: N;
  readonly per: number;
  readonly gate: G | undefined;
  readonly scale: EdgeScale<N> | undefined;
  /** This edge's slot in `Flow.rates`. */
  readonly slot: number;
  /**
   * Where the integrator reads this edge's multiplicand: `index[from]`, or — on a source — the
   * **reserved unit slot** at `Economy.order.length`, one past the last node.
   *
   * This exists so the hot loop never branches on `from === undefined`. A source is an affine
   * term, and an affine term is the same object as a node pinned to `1`: `b = A·e` for a hidden
   * unit node with no incoming edges. The workspace carries that node as one extra element
   * holding `1`, so `acc[to] += rate × x[fromIndex]` is one code path for both kinds of edge.
   * The slot is workspace only — it is **not** a node, it is not in {@link Economy.nodes}, and it
   * never reaches a stock vector or a save.
   */
  readonly fromIndex: number;
}

/**
 * A validated, frozen production graph. Build it once at load; it holds no mutable state and
 * two saves may share one.
 *
 * Every guarantee the rest of the package makes rests on the two invariants this object
 * carries: the edges point strictly forward through {@link Economy.order}, and {@link depth}
 * bounds the matrix powers. Construct one only through {@link defineEconomy} — a hand-built
 * object literal that satisfies the type can still violate both, and the integrator will not
 * terminate.
 */
export interface Economy<N extends string, G extends string = never> {
  /** As declared. The save's field order. */
  readonly nodes: readonly N[];
  /** **Computed** topological order: every producer strictly before everything it produces. */
  readonly order: readonly N[];
  /**
   * Position in `order`. For every edge that has a `from`, `index[from] < index[to]` — this is the
   * invariant. A source has no `from` and sits, conceptually, before every node in `order`.
   */
  readonly index: Readonly<Record<N, number>>;
  /**
   * Edges, sorted by `index[from]`, so a game reordering its spec cannot move a single ulp.
   * Sources sort **first**: the hidden unit node they hang off has no producer, so it precedes
   * every declared node in Kahn order.
   */
  readonly edges: readonly Edge<N, G>[];
  readonly gates: readonly G[];
  /**
   * Edges on the longest path — the nilpotency bound. `A^(depth+1) = 0`, so `x(t)` is a
   * polynomial in `t` of degree exactly `depth` and the integrator performs at most `depth`
   * matrix applications. The source game bounded this by node count (18) for a graph of depth
   * 4; the bound is a property of the graph, not of the vector, and computing it is free.
   *
   * **A source edge counts as an edge here**, because it is one: a source into `a` makes `a`
   * linear in `t` where an unfed `a` was constant, and a source into `a` with `a → b` makes `b`
   * quadratic. Forgetting to count it truncates the polynomial by one term, and a truncated
   * polynomial is still a plausible-looking number — which is why it is spelled out.
   */
  readonly depth: number;
}

/** An edge plus its declaration index, which is the final tie-break in the sort. */
interface PreparedEdge<N extends string, G extends string> {
  /** `undefined` on a source; see {@link EdgeSpec.from}. */
  readonly from: N | undefined;
  readonly to: N;
  readonly per: number;
  readonly gate: G | undefined;
  readonly scale: EdgeScale<N> | undefined;
  readonly declared: number;
}

/** `Object.prototype.hasOwnProperty`, borrowed once so a node called `hasOwnProperty` cannot lie. */
const owns = Object.prototype.hasOwnProperty;

/**
 * Name the *kind* of a value for an error message.
 *
 * `typeof null` is `'object'` and `typeof []` is `'object'`, and both of those are things a caller
 * plausibly passed by mistake — so reporting either as "object" sends the reader looking at the
 * wrong half of their spec.
 */
function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Reject anything that is not an id string, **before** it can be mistaken for one.
 *
 * This check exists ahead of the duplicate scan for a specific reason, and it is the clearest
 * example in this package of a diagnostic sending a reader to a plausible wrong place. A spec built
 * from node *objects* rather than node *ids* — `nodes: [{ id: 'lamp' }, { id: 'oil' }]`, which is
 * how most config formats look — used to report:
 *
 * ```
 * sim.defineEconomy: duplicate node '[object Object]' at spec.nodes[1]
 * ```
 *
 * Every word of that is a lie except the index. There is no duplicate: two *distinct* objects both
 * stringify to `[object Object]` and collide in the id table, so the caller is sent hunting for a
 * repeated id in a spec that has none, while the real mistake — the wrong kind of thing entirely —
 * goes unmentioned. One `typeof` ahead of the scan is the whole fix.
 *
 * A `TypeError` rather than a `RangeError`, per the kit's rule: wrong kind of thing is a
 * `TypeError`, wrong value of the right kind is a `RangeError`.
 */
function expectId(value: unknown, caller: string, where: string, what: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${caller}: expected ${where} to be a ${what} string, got ${kindOf(value)}`,
    );
  }
  return value;
}

/** Reject a spec field that should be a list, before a `for…of` reports it as "not iterable". */
function expectList(value: unknown, caller: string, where: string): void {
  if (!Array.isArray(value)) {
    throw new TypeError(`${caller}: expected ${where} to be an array, got ${kindOf(value)}`);
  }
}

/**
 * Render the declared ids for a "you named something that is not one of these" message.
 *
 * The near-miss is the point: `oill` against `lamp, oil` is a typo a reader spots instantly and
 * would not spot from the offending id alone. Truncated, because a fourteen-resource economy in an
 * error message is a wall rather than a hint.
 */
function listOf(ids: readonly string[]): string {
  const shown = ids.slice(0, 12).join(', ');
  return ids.length > 12 ? `${shown}, … (${String(ids.length)} in all)` : shown;
}

/**
 * Validate a spec and compute its evaluation order.
 *
 * The order is **derived by Kahn's algorithm and therefore proven**, not asserted against a
 * hand-written array the way the source game did it. A kit cannot ask a game author to keep a
 * topological ordering correct by hand across fourteen resources and two content updates; it
 * can compute one, and refuse the graphs that do not have one.
 *
 * Ties in Kahn — two nodes ready at the same moment — are broken by **declaration order**, per
 * the Lattice ordering rule. There is no comparator parameter, and there is no case in which
 * the order depends on how the game happened to sort its edge list.
 *
 * Validation uses `core`'s `guard` validators, which return the value rather than take a
 * boolean — so every message can name the offending node instead of reporting that something,
 * somewhere, was false.
 *
 * **This is the function every game calls first, and the one most likely to be called wrongly**, so
 * its diagnostics carry more weight than the rest of the package's put together. Two rules are held
 * to throughout: the kind of a value is checked *before* anything is inferred from it, and a
 * message that could send the reader to either of two places names both.
 *
 * @throws TypeError — wrong kind of thing — when `spec` or an edge is not an object, `nodes`,
 *   `gates` or `edges` is not an array, a node or gate id is not a string, or `scale` is not a
 *   function. The id check runs ahead of the duplicate scan on purpose; see `expectId`.
 * @throws RangeError — wrong value of the right kind, naming the caller's mistake per house rule 9
 *   — on: an empty node list; a duplicate node or gate, with *both* indices; an edge naming an
 *   undeclared node or gate, with the declared ids listed so a typo is visible; a non-finite `per`;
 *   a self-loop; or **any cycle**, with the cycle spelled out:
 *   `sim.defineEconomy: production graph has a cycle: lamp → oil → lamp. ...`
 *
 *   There is deliberately **no numerical fallback** for a cycle. A fallback would be a second
 *   implementation of the economy with different answers, and a game would cross the boundary
 *   without noticing — the two would then diverge silently on exactly the saves that matter
 *   most. Refusing happens at load rather than at hour three, and the message names the edge to
 *   delete.
 */
export function defineEconomy<N extends string, G extends string = never>(
  spec: EconomySpec<N, G>,
): Economy<N, G> {
  const label = 'sim.defineEconomy';
  expectObject(spec, `${label}: spec`);
  expectNonEmpty(spec.nodes, `${label}: spec.nodes`);

  // ── nodes ───────────────────────────────────────────────────────────────────
  //
  // The kind check comes *first*, and see `expectId` for the bug it exists to prevent: without it
  // a spec of node objects is reported as a duplicate id that does not exist.
  const declaredAt = {} as Record<N, number>;
  let position = 0;
  for (const node of spec.nodes) {
    expectId(node, label, `spec.nodes[${String(position)}]`, 'node id');
    if (owns.call(declaredAt, node)) {
      throw new RangeError(
        `${label}: duplicate node '${node}' at spec.nodes[${String(position)}] (already declared at spec.nodes[${String(declaredAt[node])}]) — a stock vector is keyed by node id, so two entries with one name are one node with two rates`,
      );
    }
    declaredAt[node] = position;
    position += 1;
  }

  // ── gates ───────────────────────────────────────────────────────────────────
  const gates: G[] = [];
  const gateDeclared = {} as Record<G, true>;
  if (spec.gates !== undefined) expectList(spec.gates, label, 'spec.gates');
  let gateAt = 0;
  for (const gate of spec.gates ?? []) {
    expectId(gate, label, `spec.gates[${String(gateAt)}]`, 'gate id');
    if (owns.call(gateDeclared, gate)) {
      throw new RangeError(
        `${label}: duplicate gate '${gate}' at spec.gates[${String(gateAt)}] — a gate id is a named operating condition, and two of them with one name is one condition the game cannot address`,
      );
    }
    gateDeclared[gate] = true;
    gates.push(gate);
    gateAt += 1;
  }

  // ── edges ───────────────────────────────────────────────────────────────────
  expectList(spec.edges, label, 'spec.edges');
  const prepared: PreparedEdge<N, G>[] = [];
  let at = 0;
  for (const edge of spec.edges) {
    const slotName = `spec.edges[${String(at)}]`;
    const where = `${label}: ${slotName}`;
    expectObject(edge, where);
    // Both destinations named, because the reader's next move depends on which mistake it was: a
    // missing node is an edit to `spec.nodes`, and a typo is an edit right here. Listing the
    // declared ids is what makes the difference visible — `oill` against `lamp, oil`.
    const expectDeclared = (id: unknown, end: 'from' | 'to'): void => {
      const name = expectId(id, label, `${slotName}.${end}`, 'node id');
      if (!owns.call(declaredAt, name)) {
        throw new RangeError(
          `${where}.${end} names '${name}', which is not a declared node — declared nodes are ${listOf(spec.nodes)}. Either add it to spec.nodes (at the end, so existing saves keep their field order) or fix the spelling here`,
        );
      }
    };
    // `to` is checked unconditionally and `from` only when it is present. The two ends stopped
    // sharing one loop the moment `from` became optional: absence is the *source* spelling, and a
    // loop would have to decide whether `undefined` on `to` meant the same thing. It does not —
    // `to` is where the production lands and there is nowhere else to put it.
    expectDeclared(edge.to, 'to');
    if (edge.from !== undefined) {
      expectDeclared(edge.from, 'from');
      if (edge.from === edge.to) {
        throw new RangeError(
          `${where} is a self-loop on '${edge.from}'. An edge adds to its target and subtracts nothing from its source, so a self-loop is exponential growth — the matrix stops being nilpotent and the closed form stops terminating`,
        );
      }
    }
    expectFinite(edge.per, `${where}.per`);
    if (edge.gate !== undefined) {
      expectId(edge.gate, label, `${slotName}.gate`, 'gate id');
      if (!owns.call(gateDeclared, edge.gate)) {
        throw new RangeError(
          `${where}.gate names '${edge.gate}', which is not a declared gate — declared gates are ${gates.length === 0 ? '(none)' : listOf(gates)}. Either declare it in spec.gates or drop the tag to leave this edge unthrottled`,
        );
      }
    }
    if (edge.scale !== undefined && typeof edge.scale !== 'function') {
      throw new TypeError(
        `${where}.scale: expected a function (stocks) => number, got ${kindOf(edge.scale)} — a scale is evaluated once per buildFlow, so a plain number here should be folded into \`per\` instead`,
      );
    }
    prepared.push({
      from: edge.from,
      to: edge.to,
      per: edge.per,
      gate: edge.gate,
      scale: edge.scale,
      declared: at,
    });
    at += 1;
  }

  // ── Kahn ────────────────────────────────────────────────────────────────────
  //
  // The ready set is scanned in *declaration* order rather than held in a queue, which makes
  // the tie-break independent of the order the game's edge list happened to be written in.
  // It is O(nodes²) at construction and never runs again.
  //
  // A **source edge does not raise an indegree**, and that is not an optimisation — it is the
  // whole reason source edges are free here. The hidden unit node a source hangs off has no
  // producer, so it is ready before Kahn starts and could be emitted first; counting its edges
  // would leave a node with an indegree nothing ever decrements, and the graph would be reported
  // as a cycle it does not contain.
  const remaining = new Set<N>(spec.nodes);
  const indegree = {} as Record<N, number>;
  for (const node of spec.nodes) indegree[node] = 0;
  for (const edge of prepared) if (edge.from !== undefined) indegree[edge.to] += 1;

  const order: N[] = [];
  for (;;) {
    let ready: N | undefined;
    for (const node of spec.nodes) {
      if (remaining.has(node) && indegree[node] === 0) {
        ready = node;
        break;
      }
    }
    if (ready === undefined) break;
    remaining.delete(ready);
    order.push(ready);
    for (const edge of prepared) {
      if (edge.from === ready) indegree[edge.to] -= 1;
    }
  }

  // Anything left is in, or downstream of, a cycle. Every leftover node still has a leftover
  // *predecessor* — that is precisely why Kahn could not emit it — so walking backwards always
  // continues and must revisit a node. Walking forwards would not: it can dead-end on a node
  // that is merely downstream of the loop, and report no cycle for a graph that has one.
  for (const start of remaining) {
    const path: N[] = [];
    const seen = new Set<N>();
    let cursor = start;
    while (!seen.has(cursor)) {
      seen.add(cursor);
      path.push(cursor);
      for (const edge of prepared) {
        // A source cannot be on a cycle — nothing produces the unit node — so it is skipped
        // rather than followed, and the walk still always continues.
        if (edge.to === cursor && edge.from !== undefined && remaining.has(edge.from)) {
          cursor = edge.from;
          break;
        }
      }
    }
    // `path` runs against the arrows and closes on `cursor`; reverse it and put `cursor` back
    // at the front to read the loop the way production flows.
    const loop = [cursor, ...path.slice(path.indexOf(cursor)).reverse()];
    throw new RangeError(
      `${label}: production graph has a cycle: ${loop.join(' → ')}. The closed form only terminates on a strictly forward graph; a feedback loop is a purchase (an action at an instant), not an edge.`,
    );
  }

  // ── the derived order, and everything keyed on it ───────────────────────────
  const index = {} as Record<N, number>;
  order.forEach((node, i) => {
    index[node] = i;
  });

  // Where an edge reads its multiplicand. `-1` for a source, because the unit node it hangs off
  // precedes every declared node; the workspace index it turns into is `order.length`, one past
  // the last node, and the two numbers are deliberately different — this one only ever orders.
  const rankOf = (from: N | undefined): number => (from === undefined ? -1 : index[from]);

  // Sorted by (from, to, per) with declaration order as the final tie-break, per the Lattice
  // ordering rule. Two edges that agree on all three are interchangeable except for `scale`,
  // and only then does the game's declaration order reach the arithmetic. Sources land first and
  // a spec with none sorts exactly as it did before they existed — which matters, because a
  // reordered edge list moves the last bit of every stock in every existing save.
  const sorted = [...prepared].sort(
    (a, b) =>
      rankOf(a.from) - rankOf(b.from) ||
      index[a.to] - index[b.to] ||
      (a.per < b.per ? -1 : a.per > b.per ? 1 : 0) ||
      a.declared - b.declared,
  );

  const unitSlot = order.length;
  const edges: Edge<N, G>[] = sorted.map((edge, slot) =>
    Object.freeze({
      from: edge.from,
      to: edge.to,
      per: edge.per,
      gate: edge.gate,
      scale: edge.scale,
      slot,
      fromIndex: edge.from === undefined ? unitSlot : index[edge.from],
    }),
  );

  // The longest path *into* each node. Edges are already in `index[from]` order and `order` is
  // topological, so every `degree[from]` is final by the time an edge out of it is read — and the
  // unit node behind a source has degree 0 always, so sources sorting first changes nothing.
  //
  // A source counts as an edge. `A^(depth+1) = 0` has to hold for the *augmented* matrix, and a
  // source into a chain of depth `d` produces a polynomial of degree `d + 1`. Miss this and the
  // integrator drops the last term of the series without ever failing.
  const degree = {} as Record<N, number>;
  for (const node of order) degree[node] = 0;
  let depth = 0;
  for (const edge of edges) {
    const reached = (edge.from === undefined ? 0 : degree[edge.from]) + 1;
    if (reached > degree[edge.to]) degree[edge.to] = reached;
    if (degree[edge.to] > depth) depth = degree[edge.to];
  }

  return Object.freeze({
    nodes: Object.freeze([...spec.nodes]),
    order: Object.freeze(order),
    index: Object.freeze(index),
    edges: Object.freeze(edges),
    gates: Object.freeze(gates),
    depth,
  });
}

/**
 * A fresh, fully-populated, all-zero vector, keyed in **storage** order.
 *
 * Every key is present and every value is a number, so the object's hidden class never changes
 * under the integrator — a vector that grows a key on the first frame a resource is unlocked
 * deoptimises every call site that has ever seen it. The key order matters for a second reason:
 * it is the order `JSON.stringify` writes, so two saves of the same economy produce byte-
 * comparable text.
 */
export function zeroStocks<N extends string, G extends string>(eco: Economy<N, G>): StockVec<N> {
  const out = {} as StockVec<N>;
  for (const node of eco.nodes) out[node] = 0;
  return out;
}

/**
 * The degree of `node`'s trajectory in `t`: the longest path *into* it, so `0` is constant,
 * `1` is linear and `2` is quadratic.
 *
 * Exported because it is the precondition of an exact depletion solve: degree 1 and 2 are
 * algebraic, and a game is entitled to know **at design time** whether the instant it wants to
 * report is available in closed form or found by bisection. A resource drained by a fixed set
 * of consumers is degree 1, which is most idle games' everything.
 *
 * A **source counts as one edge**, so a node fed only by a source is degree 1 — a constant inflow
 * makes a stock linear in time, and `solveCrossing` answers it with one divide.
 *
 * @throws TypeError if `node` is not a string — checked before the membership test, so passing a
 *   node *object* is not reported as an undeclared node called `[object Object]`.
 * @throws RangeError if `node` is not declared in `eco`, listing the ids that are.
 */
export function degreeOf<N extends string, G extends string>(
  eco: Economy<N, G>,
  node: N,
): number {
  expectId(node, 'sim.degreeOf', 'node', 'node id');
  if (!owns.call(eco.index, node)) {
    throw new RangeError(
      `sim.degreeOf: '${node}' is not a node of this economy — declared nodes are ${listOf(eco.nodes)}`,
    );
  }
  const degree = {} as Record<N, number>;
  for (const id of eco.order) degree[id] = 0;
  for (const edge of eco.edges) {
    const reached = (edge.from === undefined ? 0 : degree[edge.from]) + 1;
    if (reached > degree[edge.to]) degree[edge.to] = reached;
  }
  return degree[node];
}
