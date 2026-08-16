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
      expect(edge.from).toBeDefined();
      // Narrowed rather than asserted: `from` is optional on the spec, so reading it as a node id
      // has to survive the possibility that this edge is a source. None of these are.
      if (edge.from !== undefined) expect(eco.index[edge.from]).toBeLessThan(eco.index[edge.to]);
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

describe('defineEconomy — a message must not send the reader to a plausible wrong place', () => {
  /** The shape most config formats produce, and the one most likely to be passed by mistake. */
  const NODE_OBJECTS = [{ id: 'lamp' }, { id: 'oil' }] as unknown as readonly 'lamp'[];

  it('names the wrong *kind* of thing rather than inventing a duplicate (rule 9)', () => {
    // The bug this pins: two distinct objects both stringify to `[object Object]` and collide in
    // the id table, so the duplicate scan used to report
    //   `duplicate node '[object Object]' at spec.nodes[1]`
    // — a repeated id the caller does not have, in a spec that does not have one, while the real
    // mistake went unmentioned. The kind check has to run *ahead* of the scan.
    //
    // Note the index: the audit reported `spec.nodes[1]`, because the old message could only
    // surface at the *collision* — it needed a second object before it noticed anything. Checking
    // the kind ahead of the scan names the **first** offender instead, which is the one the reader
    // should look at.
    const message = messageOf(() => defineEconomy({ nodes: NODE_OBJECTS, edges: [] }));
    expect(message).toBe(
      'sim.defineEconomy: expected spec.nodes[0] to be a node id string, got object',
    );
    expect(message).not.toContain('duplicate');
    expect(message).not.toContain('[object Object]');
  });

  it('throws a TypeError for the wrong kind and a RangeError for the wrong value', () => {
    // The kit's split, everywhere: wrong kind of thing is a TypeError, wrong value of the right
    // kind is a RangeError. A caller catching one and not the other depends on it.
    expect(() => defineEconomy({ nodes: NODE_OBJECTS, edges: [] })).toThrow(TypeError);
    expect(() => defineEconomy({ nodes: ['oil', 'oil'], edges: [] })).toThrow(RangeError);
  });

  it('distinguishes null, an array and an object, because all three read as "object"', () => {
    for (const [node, kind] of [
      [null, 'null'],
      [['oil'], 'array'],
      [{ id: 'oil' }, 'object'],
      [7, 'number'],
      [undefined, 'undefined'],
    ] as const) {
      expect(
        messageOf(() => defineEconomy({ nodes: [node] as unknown as readonly 'oil'[], edges: [] })),
      ).toBe(`sim.defineEconomy: expected spec.nodes[0] to be a node id string, got ${kind}`);
    }
  });

  it('names a gate id that is not a string', () => {
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a'],
          gates: [{ id: 'grid' }] as unknown as readonly 'grid'[],
          edges: [],
        }),
      ),
    ).toBe('sim.defineEconomy: expected spec.gates[0] to be a gate id string, got object');
  });

  it('names an edge end that is not a string, before deciding it is undeclared', () => {
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a', 'b'],
          edges: [{ from: { id: 'a' }, to: 'b', per: 1 } as unknown as EdgeSpec<'a' | 'b', never>],
        }),
      ),
    ).toBe('sim.defineEconomy: expected spec.edges[0].from to be a node id string, got object');
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a', 'b'],
          gates: ['grid'],
          edges: [
            { from: 'a', to: 'b', per: 1, gate: 3 } as unknown as EdgeSpec<'a' | 'b', 'grid'>,
          ],
        }),
      ),
    ).toBe('sim.defineEconomy: expected spec.edges[0].gate to be a gate id string, got number');
  });

  it('names a spec, an edge or a list that is not the shape it claims', () => {
    expect(messageOf(() => defineEconomy(null as unknown as EconomySpec<'a', never>))).toContain(
      'sim.defineEconomy: spec: expected a plain object',
    );
    expect(
      messageOf(() =>
        defineEconomy({ nodes: ['a'], edges: 'nope' as unknown as readonly EdgeSpec<'a', never>[] }),
      ),
    ).toBe('sim.defineEconomy: expected spec.edges to be an array, got string');
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a'],
          gates: {} as unknown as readonly 'grid'[],
          edges: [],
        }),
      ),
    ).toBe('sim.defineEconomy: expected spec.gates to be an array, got object');
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a', 'b'],
          edges: [null as unknown as EdgeSpec<'a' | 'b', never>],
        }),
      ),
    ).toContain('sim.defineEconomy: spec.edges[0]: expected a plain object, got null');
  });

  it('names a scale that is not a function, rather than failing later inside buildFlow', () => {
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['a', 'b'],
        edges: [{ from: 'a', to: 'b', per: 1, scale: 2 } as unknown as EdgeSpec<'a' | 'b', never>],
      }),
    );
    expect(message).toContain('sim.defineEconomy: spec.edges[0].scale: expected a function');
    expect(message).toContain('got number');
    // And it names the fix, which is not "wrap it in an arrow" but "fold it into `per`".
    expect(message).toContain('folded into `per`');
  });

  it('names both indices of a duplicate, so the reader can see which one to delete', () => {
    const message = messageOf(() =>
      defineEconomy({ nodes: ['oil', 'lamp', 'oil'], edges: [] }),
    );
    expect(message).toContain('spec.nodes[2]');
    expect(message).toContain('already declared at spec.nodes[0]');
  });

  it('lists the declared ids so a near-miss is visible on sight', () => {
    // The typo case. "Add it to spec.nodes" alone sends a reader to add a node when what they
    // needed was to delete a letter.
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['lamp', 'oil'],
        edges: [{ from: 'lamp', to: 'oill', per: -1 } as unknown as EdgeSpec<'lamp' | 'oil', never>],
      }),
    );
    expect(message).toContain("names 'oill', which is not a declared node");
    expect(message).toContain('declared nodes are lamp, oil');
    expect(message).toContain('fix the spelling');
  });

  it('says "(none)" rather than an empty gap when no gate was declared at all', () => {
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a', 'b'],
          edges: [{ from: 'a', to: 'b', per: 1, gate: 'grid' } as unknown as EdgeSpec<'a' | 'b', never>],
        }),
      ),
    ).toContain('declared gates are (none)');
  });

  it('truncates a long id list rather than printing a wall', () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${String(i)}`) as readonly string[];
    const message = messageOf(() =>
      defineEconomy({
        nodes: many as readonly 'n0'[],
        edges: [{ from: 'n0', to: 'ghost', per: 1 } as unknown as EdgeSpec<'n0', never>],
      }),
    );
    expect(message).toContain('… (20 in all)');
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
    expect(fromSide).toContain("spec.edges[0].from names 'ghost', which is not a declared node");
    // Both destinations named, and the declared ids listed so a typo is visible on sight.
    expect(fromSide).toContain('declared nodes are a');
    expect(fromSide).toContain('fix the spelling');

    const toSide = messageOf(() =>
      defineEconomy({
        nodes: ['a'],
        edges: [{ from: 'a', to: 'ghost', per: 1 } as unknown as EdgeSpec<'a', never>],
      }),
    );
    expect(toSide).toContain("spec.edges[0].to names 'ghost', which is not a declared node");
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
    expect(message).toContain("spec.edges[0].gate names 'cooling', which is not a declared gate");
    expect(message).toContain('declared gates are grid');
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

describe('defineEconomy — the source edge', () => {
  it('accepts an edge with no `from` and records it as a source', () => {
    const eco = defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 3 }] });
    expect(eco.edges[0]?.from).toBeUndefined();
    expect(eco.edges[0]?.to).toBe('coin');
    expect(eco.edges[0]?.per).toBe(3);
  });

  it('points a source at the reserved unit slot, one past the last node', () => {
    // The slot is `order.length`, which is the index no node has. That is the whole implementation:
    // a source is a node pinned to 1, and the workspace is one element longer than the vector.
    const eco = defineEconomy({
      nodes: ['coin', 'ore'],
      edges: [
        { to: 'coin', per: 3 },
        { from: 'coin', to: 'ore', per: 1 },
      ],
    });
    expect(eco.order).toEqual(['coin', 'ore']);
    expect(eco.edges[0]?.fromIndex).toBe(2);
    expect(eco.edges[1]?.fromIndex).toBe(eco.index.coin);
  });

  it('counts a source in `depth`, so the polynomial is not truncated (S2)', () => {
    // A node nothing feeds is constant; a source makes it linear. One edge, one degree.
    expect(defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 3 }] }).depth).toBe(1);
    // And a source into a chain raises everything downstream: `b` is quadratic here, not linear.
    // The failure this pins is silent — a truncated series still returns a plausible number.
    const chained = defineEconomy({
      nodes: ['a', 'b'],
      edges: [
        { to: 'a', per: 1 },
        { from: 'a', to: 'b', per: 1 },
      ],
    });
    expect(chained.depth).toBe(2);
    expect(degreeOf(chained, 'a')).toBe(1);
    expect(degreeOf(chained, 'b')).toBe(2);
  });

  it('does not raise an indegree, so a fed node is still a valid Kahn root', () => {
    // If a source counted towards indegree, nothing would ever decrement it and this graph would
    // be reported as a cycle it does not contain.
    const eco = defineEconomy({
      nodes: ['coin', 'lamp'],
      edges: [
        { to: 'coin', per: 1 },
        { to: 'lamp', per: 1 },
        { from: 'lamp', to: 'coin', per: 1 },
      ],
    });
    expect(eco.order).toEqual(['lamp', 'coin']);
    expect(eco.depth).toBe(2);
  });

  it('sorts sources first and leaves a source-free spec exactly as it was (S6)', () => {
    // The existing suite pins DIAMOND's order and edge sequence; this pins that *adding* a source
    // only prepends. A reordered edge list moves the last bit of every stock in every save.
    const withSource = defineEconomy({
      nodes: DIAMOND.nodes,
      edges: [...DIAMOND.edges, { to: 'bloom', per: 9 }],
    });
    const without = defineEconomy(DIAMOND);
    expect(withSource.order).toEqual(without.order);
    expect(withSource.edges[0]?.from).toBeUndefined();
    expect(withSource.edges.slice(1).map((e) => `${String(e.from)}->${e.to}@${String(e.per)}`)).toEqual(
      without.edges.map((e) => `${String(e.from)}->${e.to}@${String(e.per)}`),
    );
  });

  it('is not a self-loop, however the target is named', () => {
    // `from === to` is the self-loop test, and `undefined === 'heat'` is false. A source into the
    // node the workaround would have divided by is the case that used to be unspellable.
    const eco = defineEconomy({ nodes: ['heat'], edges: [{ to: 'heat', per: 1 }] });
    expect(eco.depth).toBe(1);
  });

  it('accepts a gated source, and refuses one naming a gate nobody declared (S4)', () => {
    const gated = defineEconomy({
      nodes: ['coin'],
      gates: ['night'],
      edges: [{ to: 'coin', per: 1, gate: 'night' }],
    });
    expect(gated.edges[0]?.gate).toBe('night');

    // Gate validation is keyed on the edge, not on its `from` — so an economy with no gates at all
    // still accepts a source, and a source naming a phantom gate is still named.
    expect(defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 1 }] }).gates).toEqual([]);
    const message = messageOf(() =>
      defineEconomy({
        nodes: ['coin'],
        gates: ['night'],
        edges: [{ to: 'coin', per: 1, gate: 'dawn' } as unknown as EdgeSpec<'coin', 'night'>],
      }),
    );
    expect(message).toContain("spec.edges[0].gate names 'dawn', which is not a declared gate");
  });

  it('refuses an edge with no `to`, and says so by name (S5)', () => {
    // `to` is where the production lands and there is nowhere else to put it. It never becomes
    // optional, and the message must name the field rather than reporting a missing node.
    const message = messageOf(() =>
      defineEconomy({ nodes: ['coin'], edges: [{ per: 3 } as unknown as EdgeSpec<'coin', never>] }),
    );
    expect(message).toBe(
      'sim.defineEconomy: expected spec.edges[0].to to be a node id string, got undefined',
    );
    expect(() =>
      defineEconomy({ nodes: ['coin'], edges: [{ per: 3 } as unknown as EdgeSpec<'coin', never>] }),
    ).toThrow(TypeError);
  });

  it('treats only *absence* as a source — a `from` of null is still a mistake', () => {
    // The distinction matters because `null` is what a JSON-shaped spec produces for a field
    // someone meant to fill in, and silently reading it as "no producer" would turn a typo into a
    // free income stream.
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['a', 'b'],
          edges: [{ from: null, to: 'b', per: 1 } as unknown as EdgeSpec<'a' | 'b', never>],
        }),
      ),
    ).toBe('sim.defineEconomy: expected spec.edges[0].from to be a node id string, got null');
  });

  it('still refuses a source whose `to` is not a declared node', () => {
    expect(
      messageOf(() =>
        defineEconomy({
          nodes: ['coin'],
          edges: [{ to: 'ghost', per: 1 } as unknown as EdgeSpec<'coin', never>],
        }),
      ),
    ).toContain("spec.edges[0].to names 'ghost', which is not a declared node");
  });

  it('keeps the save to exactly the declared nodes (S7)', () => {
    // The finding this whole field exists for: the workaround put a node in `nodes` — which *is*
    // the save's field order — purely to be a multiplicand. The unit slot is workspace and cannot
    // be addressed from a stock vector.
    const eco = defineEconomy({ nodes: ['coin'], edges: [{ to: 'coin', per: 3 }] });
    expect(JSON.stringify(zeroStocks(eco))).toBe('{"coin":0}');
    expect(Object.keys(zeroStocks(eco))).toHaveLength(1);
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

  it('serializes with the declared field order', () => {
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
