import { describe, expect, it } from 'vitest';

import { defineEconomy, degreeOf, zeroStocks } from '../src/graph.js';
import type { EconomySpec, EdgeSpec } from '../src/graph.js';

/** The message contract, from the constitution's rule 9: the label and the value, both. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a throw, and nothing was thrown');
}

/**
 * A four-node diamond, declared in an order that is deliberately *not* topological.
 *
 * `seed → sprout` and `seed → root`, both feeding `bloom`. Declaring `bloom` first is the whole
 * point: if the evaluation order were the declared one, `bloom` would be integrated before either
 * of its producers and the answer would be wrong in a way no type could catch.
 */
const DIAMOND: EconomySpec<'bloom' | 'sprout' | 'root' | 'seed', never> = {
  nodes: ['bloom', 'sprout', 'root', 'seed'],
  edges: [
    { from: 'sprout', to: 'bloom', per: 2 },
    { from: 'root', to: 'bloom', per: 3 },
    { from: 'seed', to: 'sprout', per: 1 },
    { from: 'seed', to: 'root', per: 1 },
  ],
};

describe('defineEconomy — the order is computed, never declared', () => {
  it('puts every producer strictly before everything it produces (I1)', () => {
    const eco = defineEconomy(DIAMOND);
    for (const edge of eco.edges) {
      expect(eco.index[edge.from]).toBeLessThan(eco.index[edge.to]);
    }
  });

  it('keeps storage order and evaluation order as separate things', () => {
    const eco = defineEconomy(DIAMOND);
    // Storage order is exactly as declared, so a v1 save's fields never move.
    expect(eco.nodes).toEqual(['bloom', 'sprout', 'root', 'seed']);
    // Evaluation order is Kahn's, tie-broken by declaration order: `seed` is the only source, then
    // `sprout` and `root` become ready together and are emitted in the order they were declared.
    expect(eco.order).toEqual(['seed', 'sprout', 'root', 'bloom']);
  });

  it('is independent of the order the edge list was written in (I5)', () => {
    const shuffled: EconomySpec<'bloom' | 'sprout' | 'root' | 'seed', never> = {
      nodes: DIAMOND.nodes,
      edges: [
        { from: 'seed', to: 'root', per: 1 },
        { from: 'sprout', to: 'bloom', per: 2 },
        { from: 'seed', to: 'sprout', per: 1 },
        { from: 'root', to: 'bloom', per: 3 },
      ],
    };
    const a = defineEconomy(DIAMOND);
    const b = defineEconomy(shuffled);
    expect(b.order).toEqual(a.order);
    expect(b.edges.map((e) => `${e.from}->${e.to}@${String(e.per)}`)).toEqual(
      a.edges.map((e) => `${e.from}->${e.to}@${String(e.per)}`),
    );
  });

  it('breaks ties between parallel edges by rate, then by declaration order', () => {
    // Two edges between the same pair are indistinguishable to `index`, so the sort falls through
    // to `per` and then — for edges that agree on that too — to the order they were written in.
    // Float addition is not associative, so *something* has to fix the accumulation order, and it
    // has to be the package rather than a designer's text file.
    const eco = defineEconomy({
      nodes: ['a', 'b'],
      edges: [
        { from: 'a', to: 'b', per: 5, scale: () => 1 },
        { from: 'a', to: 'b', per: 2 },
        { from: 'a', to: 'b', per: 5, scale: () => 3 },
      ],
    });
    expect(eco.edges.map((e) => e.per)).toEqual([2, 5, 5]);
    // The two 5s kept the order they were declared in: the first still has the scale returning 1.
    expect(eco.edges[1]?.scale?.({ a: 0, b: 0 })).toBe(1);
    expect(eco.edges[2]?.scale?.({ a: 0, b: 0 })).toBe(3);
  });

  it('numbers the edge slots by the sorted order, so `rates` is parallel to `edges`', () => {
    const eco = defineEconomy(DIAMOND);
    expect(eco.edges.map((e) => e.slot)).toEqual([0, 1, 2, 3]);
  });

  it('computes depth as the longest path in edges, not the node count', () => {
    // seed → sprout → bloom is two edges. Four nodes; the source game would have said four.
    expect(defineEconomy(DIAMOND).depth).toBe(2);
    expect(defineEconomy({ nodes: ['a'], edges: [] }).depth).toBe(0);
    expect(
      defineEconomy({
        nodes: ['a', 'b', 'c', 'd'],
        edges: [
          { from: 'a', to: 'b', per: 1 },
          { from: 'b', to: 'c', per: 1 },
          { from: 'c', to: 'd', per: 1 },
        ],
      }).depth,
    ).toBe(3);
  });

  it('carries the gates it was given, and only those', () => {
    const eco = defineEconomy({
      nodes: ['lamp', 'oil'],
      gates: ['dark', 'wind'],
      edges: [{ from: 'lamp', to: 'oil', per: -1, gate: 'dark' }],
    });
    expect(eco.gates).toEqual(['dark', 'wind']);
    expect(eco.edges[0]?.gate).toBe('dark');
  });

  it('leaves an untagged edge with no gate and no scale', () => {
    const eco = defineEconomy({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', per: 1 }] });
    expect(eco.edges[0]?.gate).toBeUndefined();
    expect(eco.edges[0]?.scale).toBeUndefined();
  });

  it('freezes what it returns, so two saves may share one', () => {
    const eco = defineEconomy(DIAMOND);
    expect(Object.isFrozen(eco)).toBe(true);
    expect(Object.isFrozen(eco.edges)).toBe(true);
    expect(Object.isFrozen(eco.index)).toBe(true);
  });
});

describe('defineEconomy — what it refuses, and what the message says', () => {
  it('refuses an empty node list', () => {
    expect(messageOf(() => defineEconomy({ nodes: [], edges: [] }))).toContain('non-empty array');
  });

  it('names a duplicate node and where it was declared', () => {
    const message = messageOf(() =>
      defineEconomy({ nodes: ['oil', 'lamp', 'oil'], edges: [] }),
    );
    expect(message).toContain("duplicate node 'oil'");
    expect(message).toContain('spec.nodes[2]');
  });

  it('names a duplicate gate', () => {
    expect(
      messageOf(() => defineEconomy({ nodes: ['a'], gates: ['grid', 'grid'], edges: [] })),
    ).toContain("duplicate gate 'grid'");
  });

  it('names an edge that points at a node nobody declared', () => {
    const fromSide = messageOf(() =>
      defineEconomy({
        nodes: ['a'],
        edges: [{ from: 'ghost', to: 'a', per: 1 } as unknown as EdgeSpec<'a', never>],
      }),
    );
    expect(fromSide).toContain("spec.edges[0].from names an undeclared node 'ghost'");

    const toSide = messageOf(() =>
      defineEconomy({
        nodes: ['a'],
        edges: [{ from: 'a', to: 'ghost', per: 1 } as unknown as EdgeSpec<'a', never>],
      }),
    );
    expect(toSide).toContain("spec.edges[0].to names an undeclared node 'ghost'");
  });

  it('names a self-loop as a self-loop, not as a cycle (I2)', () => {
    const message = messageOf(() =>
      defineEconomy({ nodes: ['heat'], edges: [{ from: 'heat', to: 'heat', per: 1 }] }),
    );
    expect(message).toContain("spec.edges[0] is a self-loop on 'heat'");
    expect(message).toContain('nilpotent');
  });

  it('names a non-finite rate and which edge carried it', () => {
    for (const per of [Number.NaN, Infinity, -Infinity]) {
      const message = messageOf(() =>
        defineEconomy({ nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b', per }] }),
      );
      expect(message).toContain('spec.edges[0].per');
    }
  });

  it('names an undeclared gate', () => {
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['a', 'b'],
        gates: ['grid'],
        edges: [{ from: 'a', to: 'b', per: 1, gate: 'cooling' } as unknown as EdgeSpec<'a' | 'b', 'grid'>],
      }),
    );
    expect(message).toContain("spec.edges[0].gate names an undeclared gate 'cooling'");
  });

  it('spells out a two-node cycle (I2)', () => {
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['lamp', 'oil'],
        edges: [
          { from: 'oil', to: 'lamp', per: 1 },
          { from: 'lamp', to: 'oil', per: 1 },
        ],
      }),
    );
    expect(message).toContain('production graph has a cycle: lamp → oil → lamp');
    expect(message).toContain('a feedback loop is a purchase');
  });

  it('spells out a three-node cycle', () => {
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['a', 'b', 'c'],
        edges: [
          { from: 'a', to: 'b', per: 1 },
          { from: 'b', to: 'c', per: 1 },
          { from: 'c', to: 'a', per: 1 },
        ],
      }),
    );
    expect(message).toContain('production graph has a cycle: a → b → c → a');
  });

  it('finds the cycle even when the lowest-declared leftover node is only downstream of it', () => {
    // `tail` is not on the loop; it merely hangs off it. Walking *forwards* from the
    // lowest-declared leftover node dead-ends on `tail` and reports no cycle at all; walking
    // backwards cannot, which is why the implementation walks backwards.
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['tail', 'a', 'b'],
        edges: [
          { from: 'a', to: 'b', per: 1 },
          { from: 'b', to: 'a', per: 1 },
          { from: 'b', to: 'tail', per: 1 },
        ],
      }),
    );
    expect(message).toContain('has a cycle: ');
    expect(message).not.toContain('tail →');
  });

  it('accepts a graph whose only backwards-looking edge is a negative rate', () => {
    // A linear drain is not a consuming edge: lamps burn oil at a fixed rate per lamp, which is a
    // forward edge with a negative `per` and is fully supported.
    const eco = defineEconomy({
      nodes: ['lamp', 'oil'],
      edges: [{ from: 'lamp', to: 'oil', per: -1 }],
    });
    expect(eco.depth).toBe(1);
  });
});

describe('zeroStocks', () => {
  it('fills every declared key with zero, in storage order', () => {
    const eco = defineEconomy(DIAMOND);
    const stocks = zeroStocks(eco);
    expect(Object.keys(stocks)).toEqual(['bloom', 'sprout', 'root', 'seed']);
    expect(Object.values(stocks)).toEqual([0, 0, 0, 0]);
  });

  it('returns a fresh object each time, so two ledgers cannot alias', () => {
    const eco = defineEconomy(DIAMOND);
    const a = zeroStocks(eco);
    const b = zeroStocks(eco);
    a.bloom = 5;
    expect(b.bloom).toBe(0);
  });

  it('serialises with the declared field order', () => {
    const eco = defineEconomy(DIAMOND);
    expect(JSON.stringify(zeroStocks(eco))).toBe('{"bloom":0,"sprout":0,"root":0,"seed":0}');
  });
});

describe('degreeOf', () => {
  it('reports the longest path *into* a node', () => {
    const eco = defineEconomy(DIAMOND);
    expect(degreeOf(eco, 'seed')).toBe(0);
    expect(degreeOf(eco, 'sprout')).toBe(1);
    expect(degreeOf(eco, 'root')).toBe(1);
    expect(degreeOf(eco, 'bloom')).toBe(2);
  });

  it('is the precondition a game checks at design time for an exact depletion solve', () => {
    const eco = defineEconomy({
      nodes: ['press', 'lamp', 'oil'],
      edges: [
        { from: 'press', to: 'lamp', per: 0.01 },
        { from: 'lamp', to: 'oil', per: -1 },
      ],
    });
    // Oil is degree 2 here, because lamps are produced. Make lamps a purchased count instead and
    // it drops to 1 — which is the whole reason this is exported.
    expect(degreeOf(eco, 'oil')).toBe(2);
  });

  it('names a node it has never heard of', () => {
    const eco = defineEconomy(DIAMOND);
    expect(messageOf(() => degreeOf(eco, 'ghost' as 'seed'))).toContain(
      "sim.degreeOf: 'ghost' is not a node of this economy",
    );
  });
});
