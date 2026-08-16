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
 * Isomorphic and Tier A: nothing here reads a clock, a random source or a platform, and every
 * arithmetic operation is comparison and integer addition.
 */

import { expectFinite, expectNonEmpty } from '@lattice/core';

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

/**
 * One production edge: `d(to)/dt += rate × stock(from)`.
 *
 * **Non-consuming.** The edge adds to `to` and subtracts nothing from `from`; a consuming edge
 * would put a negative term on the diagonal, `A` would stop being nilpotent, and the closed
 * form would stop terminating. A *linear drain* — lamps burning oil at a fixed rate per lamp —
 * is not that, and is fully supported: it is a forward edge with a negative `per`.
 */
export interface EdgeSpec<N extends string, G extends string> {
  readonly from: N;
  readonly to: N;
  /** Units of `to` per unit of `from` per second, before `scale` and before the gate. */
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
  /** Position in `order`. For every edge, `index[from] < index[to]` — this is the invariant. */
  readonly index: Readonly<Record<N, number>>;
  /** Edges, sorted by `index[from]`, so a game reordering its spec cannot move a single ulp. */
  readonly edges: readonly Edge<N, G>[];
  readonly gates: readonly G[];
  /**
   * Edges on the longest path — the nilpotency bound. `A^(depth+1) = 0`, so `x(t)` is a
   * polynomial in `t` of degree exactly `depth` and the integrator performs at most `depth`
   * matrix applications. The source game bounded this by node count (18) for a graph of depth
   * 4; the bound is a property of the graph, not of the vector, and computing it is free.
   */
  readonly depth: number;
}

/** An edge plus its declaration index, which is the final tie-break in the sort. */
interface PreparedEdge<N extends string, G extends string> {
  readonly from: N;
  readonly to: N;
  readonly per: number;
  readonly gate: G | undefined;
  readonly scale: EdgeScale<N> | undefined;
  readonly declared: number;
}

/** `Object.prototype.hasOwnProperty`, borrowed once so a node called `hasOwnProperty` cannot lie. */
const owns = Object.prototype.hasOwnProperty;

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
 * @throws RangeError — naming the caller's mistake, per house rule 9 — on: an empty node list;
 *   a duplicate node or gate; an edge naming an undeclared node or an undeclared gate; a
 *   non-finite `per`; a self-loop; or **any cycle**, with the cycle spelled out:
 *   `sim.defineEconomy: production graph has a cycle: oil → lamp → oil. ...`
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
  expectNonEmpty(spec.nodes, `${label}: spec.nodes`);

  // ── nodes ───────────────────────────────────────────────────────────────────
  const declaredAt = {} as Record<N, number>;
  let position = 0;
  for (const node of spec.nodes) {
    if (owns.call(declaredAt, node)) {
      throw new RangeError(
        `${label}: duplicate node '${node}' at spec.nodes[${String(position)}] — a stock vector is keyed by node id, so two entries with one name are one node with two rates`,
      );
    }
    declaredAt[node] = position;
    position += 1;
  }

  // ── gates ───────────────────────────────────────────────────────────────────
  const gates: G[] = [];
  const gateDeclared = {} as Record<G, true>;
  for (const gate of spec.gates ?? []) {
    if (owns.call(gateDeclared, gate)) {
      throw new RangeError(
        `${label}: duplicate gate '${gate}' in spec.gates — a gate id is a named operating condition, and two of them with one name is one condition the game cannot address`,
      );
    }
    gateDeclared[gate] = true;
    gates.push(gate);
  }

  // ── edges ───────────────────────────────────────────────────────────────────
  const prepared: PreparedEdge<N, G>[] = [];
  let at = 0;
  for (const edge of spec.edges) {
    const where = `${label}: spec.edges[${String(at)}]`;
    if (!owns.call(declaredAt, edge.from)) {
      throw new RangeError(
        `${where}.from names an undeclared node '${edge.from}' — add it to spec.nodes, at the end, so existing saves keep their field order`,
      );
    }
    if (!owns.call(declaredAt, edge.to)) {
      throw new RangeError(
        `${where}.to names an undeclared node '${edge.to}' — add it to spec.nodes, at the end, so existing saves keep their field order`,
      );
    }
    if (edge.from === edge.to) {
      throw new RangeError(
        `${where} is a self-loop on '${edge.from}'. An edge adds to its target and subtracts nothing from its source, so a self-loop is exponential growth — the matrix stops being nilpotent and the closed form stops terminating`,
      );
    }
    expectFinite(edge.per, `${where}.per`);
    if (edge.gate !== undefined && !owns.call(gateDeclared, edge.gate)) {
      throw new RangeError(
        `${where}.gate names an undeclared gate '${edge.gate}' — declare it in spec.gates, or drop the tag to leave the edge unthrottled`,
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
  const remaining = new Set<N>(spec.nodes);
  const indegree = {} as Record<N, number>;
  for (const node of spec.nodes) indegree[node] = 0;
  for (const edge of prepared) indegree[edge.to] += 1;

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
        if (edge.to === cursor && remaining.has(edge.from)) {
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

  // Sorted by (from, to, per) with declaration order as the final tie-break, per the Lattice
  // ordering rule. Two edges that agree on all three are interchangeable except for `scale`,
  // and only then does the game's declaration order reach the arithmetic.
  const sorted = [...prepared].sort(
    (a, b) =>
      index[a.from] - index[b.from] ||
      index[a.to] - index[b.to] ||
      (a.per < b.per ? -1 : a.per > b.per ? 1 : 0) ||
      a.declared - b.declared,
  );

  const edges: Edge<N, G>[] = sorted.map((edge, slot) =>
    Object.freeze({
      from: edge.from,
      to: edge.to,
      per: edge.per,
      gate: edge.gate,
      scale: edge.scale,
      slot,
    }),
  );

  // The longest path *into* each node. Edges are already in `index[from]` order and `order` is
  // topological, so every `degree[from]` is final by the time an edge out of it is read.
  const degree = {} as Record<N, number>;
  for (const node of order) degree[node] = 0;
  let depth = 0;
  for (const edge of edges) {
    const reached = degree[edge.from] + 1;
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
 * @throws RangeError if `node` is not declared in `eco`.
 */
export function degreeOf<N extends string, G extends string>(
  eco: Economy<N, G>,
  node: N,
): number {
  if (!owns.call(eco.index, node)) {
    throw new RangeError(
      `sim.degreeOf: '${node}' is not a node of this economy — declared nodes are ${eco.nodes.join(', ')}`,
    );
  }
  const degree = {} as Record<N, number>;
  for (const id of eco.order) degree[id] = 0;
  for (const edge of eco.edges) {
    const reached = degree[edge.from] + 1;
    if (reached > degree[edge.to]) degree[edge.to] = reached;
  }
  return degree[node];
}
