import { describe, expect, it } from 'vitest';
import { expectObject, expectRecordOfFinite } from '@lattice/core';
import { migrations, type ChainBuilder, type Increment, type Recognise } from '../src/migrate.js';

interface V1 {
  readonly version: 1;
  readonly coins: number;
}
interface V2 {
  readonly version: 2;
  readonly wallet: { readonly coin: number };
}
interface V3 {
  readonly version: 3;
  readonly wallet: { readonly coin: number };
  readonly name: string;
}

/** Recognisers return the value typed, or throw naming the field. Never a boolean. */
const isV1: Recognise<V1> = (value) => {
  const coins = (value as { coins?: unknown }).coins;
  if (typeof coins !== 'number' || !Number.isFinite(coins)) {
    throw new RangeError(`save.v1.coins: expected a finite number, got ${String(coins)}`);
  }
  return { version: 1, coins };
};

const isV2: Recognise<V2> = (value) => {
  const wallet = (value as { wallet?: unknown }).wallet;
  const coin = (wallet as { coin?: unknown } | undefined)?.coin;
  if (typeof coin !== 'number' || !Number.isFinite(coin)) {
    throw new RangeError(`save.v2.wallet.coin: expected a finite number, got ${String(coin)}`);
  }
  return { version: 2, wallet: { coin } };
};

const isV3: Recognise<V3> = (value) => {
  const v2 = isV2(value);
  const name = (value as { name?: unknown }).name;
  if (typeof name !== 'string') {
    throw new TypeError(`save.v3.name: expected a string, got ${String(name)}`);
  }
  return { version: 3, wallet: v2.wallet, name };
};

const chain = migrations(1, isV1)
  .step(2, 'one coin counter became a wallet of currencies', (v1) => ({ version: 2 as const, wallet: { coin: v1.coins } }), isV2)
  .step(3, 'campuses got a player-chosen name', (v2) => ({ ...v2, version: 3 as const, name: 'unnamed' }), isV3)
  .seal();

describe('the chain is the version', () => {
  it('reports its floor, head and rungs', () => {
    expect(chain.floor).toBe(1);
    expect(chain.head).toBe(3);
    expect(chain.steps).toEqual([
      { from: 1, to: 2, why: 'one coin counter became a wallet of currencies' },
      { from: 2, to: 3, why: 'campuses got a player-chosen name' },
    ]);
  });

  it('carries the head in the type, so `chain.head` narrows to a literal', () => {
    const head: 3 = chain.head;
    expect(head).toBe(3);
  });

  it('makes a skipped version fail to compile', () => {
    // The compile-time half of "a hole is unconstructable". `Increment<1>` is `2`, so `3` is
    // rejected with `Argument of type '3' is not assignable to parameter of type '2'`.
    // @ts-expect-error a rung must step exactly one version
    migrations(1, isV1).step(3, 'skips version 2', (v1) => v1, isV1);

    const two: Increment<1> = 2;
    const oneHundred: Increment<99> = 100;
    expect([two, oneHundred]).toEqual([2, 100]);

    // @ts-expect-error Increment<1> is 2, not 3
    const wrong: Increment<1> = 3;
    expect(wrong).toBe(3);
  });
});

describe('run', () => {
  it('migrates the floor all the way to the head, recognising at every version', () => {
    expect(chain.run({ coins: 7 }, 1)).toEqual({ version: 3, wallet: { coin: 7 }, name: 'unnamed' });
  });

  it('starts wherever the save was', () => {
    expect(chain.run({ wallet: { coin: 4 } }, 2)).toEqual({ version: 3, wallet: { coin: 4 }, name: 'unnamed' });
    expect(chain.run({ wallet: { coin: 4 }, name: 'north' }, 3)).toEqual({
      version: 3,
      wallet: { coin: 4 },
      name: 'north',
    });
  });

  it('reports every version it arrives at, in order, ending at the head', () => {
    const entered: number[] = [];
    chain.run({ coins: 1 }, 1, (v) => entered.push(v));
    expect(entered).toEqual([1, 2, 3]);

    const fromHead: number[] = [];
    chain.run({ wallet: { coin: 1 }, name: 'n' }, 3, (v) => fromHead.push(v));
    expect(fromHead).toEqual([3]);
  });

  it('stops at the version whose recogniser refused, and says which field', () => {
    const entered: number[] = [];
    expect(() => chain.run({ coins: 'many' }, 1, (v) => entered.push(v))).toThrow(/save\.v1\.coins/);
    expect(entered).toEqual([1]);
  });

  it('throws whatever game code threw, unchanged — no wrapper', () => {
    const sentinel = { why: 'a migration may throw anything at all' };
    const throwing = migrations(1, isV1)
      .step(
        2,
        'a rung that fails',
        (): V2 => {
          throw sentinel;
        },
        isV2,
      )
      .seal();
    expect(() => throwing.run({ coins: 1 }, 1)).toThrow();
    try {
      throwing.run({ coins: 1 }, 1);
      expect.unreachable('the rung must throw');
    } catch (error) {
      expect(error).toBe(sentinel);
    }
  });

  it('refuses a version outside [floor, head] — the store has already turned those into failures', () => {
    expect(() => chain.run({}, 0)).toThrow(RangeError);
    expect(() => chain.run({}, 4)).toThrow(/expected a version in \[1, 3\]/);
    expect(() => chain.run({}, 1.5)).toThrow(RangeError);
  });

  it('recognises with the head recogniser last, so a chain bug is caught at the head', () => {
    // The rung produces something its own recogniser accepts and the head's does not.
    expect(() => chain.run({ wallet: { coin: Number.NaN } }, 2)).toThrow(/save\.v2\.wallet\.coin/);
  });
});

describe('a chain with no rungs — the replay policy, expressed in the save machinery', () => {
  const evidence = migrations(4, isV3).seal();

  it('has floor equal to head and no steps', () => {
    expect(evidence.floor).toBe(4);
    expect(evidence.head).toBe(4);
    expect(evidence.steps).toEqual([]);
  });

  it('recognises at its one version and refuses to be run from any other', () => {
    expect(evidence.run({ wallet: { coin: 1 }, name: 'n' }, 4)).toEqual({
      version: 3,
      wallet: { coin: 1 },
      name: 'n',
    });
    expect(() => evidence.run({}, 3)).toThrow(RangeError);
  });
});

describe('seal', () => {
  /** The escape hatch a JavaScript caller has, and the reason `seal` re-checks at runtime. */
  function untyped(builder: ChainBuilder<1, V1>): {
    step: (to: number, why: string, migrate: (prior: V1) => V1, recognise: Recognise<V1>) => unknown;
  } {
    return builder as unknown as {
      step: (to: number, why: string, migrate: (prior: V1) => V1, recognise: Recognise<V1>) => unknown;
    };
  }

  it('names the version that has no migration', () => {
    const holed = untyped(migrations(1, isV1)).step(3, 'skips 2', (v1) => v1, isV1) as ChainBuilder<3, V1>;
    expect(() => holed.seal()).toThrow(/jumps 1 → 3; version 2 has no migration/);
    expect(() => holed.seal()).toThrow(RangeError);
  });

  it('refuses a rung that goes backwards', () => {
    const backwards = untyped(migrations(1, isV1)).step(0, 'downgrade', (v1) => v1, isV1) as ChainBuilder<0, V1>;
    expect(() => backwards.seal()).toThrow(/steps backwards 1 → 0/);
  });

  it('refuses a non-integer version', () => {
    const fractional = untyped(migrations(1, isV1)).step(1.5, 'half a rung', (v1) => v1, isV1) as ChainBuilder<2, V1>;
    expect(() => fractional.seal()).toThrow(/not an integer version/);
  });

  it('leaves the builder reusable, so a test can branch a chain', () => {
    const base = migrations(1, isV1);
    const short = base.seal();
    const long = base.step(2, 'a wallet', (v1) => ({ version: 2 as const, wallet: { coin: v1.coins } }), isV2).seal();
    expect(short.head).toBe(1);
    expect(long.head).toBe(2);
    expect(short.steps).toEqual([]);
  });
});

describe('the Recognise example from the doc comment, verbatim', () => {
  // If this stops compiling, the doc comment on `Recognise` is wrong and a reader who copies
  // it gets a type error they did not write. That is the entire point of it living here: an
  // example nobody compiles is a claim nobody checks.
  interface Wallet {
    readonly version: 2;
    readonly wallet: Record<string, number>;
  }

  const isWallet: Recognise<Wallet> = (value) => {
    const o = expectObject(value, 'save.v2');
    return { version: 2, wallet: expectRecordOfFinite(o['wallet'], 'save.v2.wallet') };
  };

  it('recognises a good payload and returns it typed', () => {
    expect(isWallet({ wallet: { coin: 12, ore: 3 } })).toEqual({ version: 2, wallet: { coin: 12, ore: 3 } });
  });

  it('names the field that was wrong, which is what makes a rejection a bug report', () => {
    expect(() => isWallet('not an object')).toThrow(/save\.v2/);
    expect(() => isWallet({ wallet: { coin: Number.POSITIVE_INFINITY } })).toThrow(/save\.v2\.wallet\.coin/);
  });

  it('drives a chain built from it, so the composition is checked and not just the guard', () => {
    const built = migrations(2, isWallet).seal();
    expect(built.run({ wallet: { coin: 1 } }, 2)).toEqual({ version: 2, wallet: { coin: 1 } });
  });
});

describe('construction refuses nonsense loudly, at a moment that is not a player’s boot', () => {
  it('rejects a floor that is not an integer', () => {
    expect(() => migrations(1.5, isV1)).toThrow(RangeError);
  });

  it('rejects a missing recogniser, including at the floor', () => {
    expect(() => migrations(1, undefined as unknown as Recognise<V1>)).toThrow(TypeError);
    expect(() =>
      migrations(1, isV1).step(2, 'why', (v1) => v1, undefined as unknown as Recognise<V1>),
    ).toThrow(TypeError);
    expect(() =>
      migrations(1, isV1).step(2, 'why', undefined as unknown as (prior: V1) => V1, isV1),
    ).toThrow(/expected a migrate function/);
  });

  it('rejects a rung with no prose, because that prose is all a reviewer gets', () => {
    expect(() => migrations(1, isV1).step(2, '   ', (v1) => v1, isV1)).toThrow(/why this rung exists/);
    expect(() => migrations(1, isV1).step(2, undefined as unknown as string, (v1) => v1, isV1)).toThrow(TypeError);
  });
});
