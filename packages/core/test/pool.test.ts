import { describe, expect, it } from 'vitest';

import { Pool, type PoolOptions } from '../src/pool.js';

interface Spark {
  x: number;
  y: number;
  owner: { name: string } | undefined;
}

const sparkOptions = (extra?: Partial<PoolOptions<Spark>>): PoolOptions<Spark> => ({
  create: (): Spark => ({ x: 0, y: 0, owner: undefined }),
  reset: (s: Spark): void => {
    s.x = 0;
    s.y = 0;
    s.owner = undefined;
  },
  ...extra,
});

/**
 * The message a call threw, as a string, or a sentinel that reads correctly in a diff.
 *
 * Returning `'did not throw'` rather than throwing keeps the failure output about the
 * message under test: a `toContain` against that sentinel says what was expected and what
 * happened, where an escaped error says only that something else went wrong.
 */
const messageOf = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'did not throw';
};

describe('Pool acquire and release', () => {
  it('creates on demand and counts what it has ever created', () => {
    const pool = new Pool(sparkOptions());
    expect(pool.size).toBe(0);
    expect(pool.free).toBe(0);

    const a = pool.acquire();
    const b = pool.acquire();

    expect(pool.size).toBe(2);
    expect(pool.free).toBe(0);
    expect(a).not.toBe(b);
  });

  it('hands back the same instance after a release, reset', () => {
    const pool = new Pool(sparkOptions());
    const spark = pool.acquire();
    spark.x = 12;
    spark.owner = { name: 'furnace' };

    pool.release(spark);
    expect(pool.free).toBe(1);

    const again = pool.acquire();
    expect(again).toBe(spark);
    expect(again.x).toBe(0);
    expect(again.owner).toBeUndefined();
    expect(pool.size).toBe(1);
  });

  it('clears references on release, not on acquire, so nothing is held alive on the free list', () => {
    let cleared = false;
    const pool = new Pool<Spark>({
      create: () => ({ x: 0, y: 0, owner: undefined }),
      reset: (s) => {
        s.owner = undefined;
        cleared = true;
      },
    });
    const spark = pool.acquire();
    spark.owner = { name: 'furnace' };

    pool.release(spark);

    expect(cleared).toBe(true);
    expect(spark.owner).toBeUndefined();
  });

  it('works without a reset', () => {
    const pool = new Pool<number[]>({ create: () => [] });
    const item = pool.acquire();
    item.push(1);
    pool.release(item);

    expect(pool.acquire()).toBe(item);
    expect(item).toEqual([1]);
  });

  it('reuses one instance across ten thousand acquire/release pairs', () => {
    const pool = new Pool(sparkOptions());
    for (let i = 0; i < 10_000; i += 1) {
      const spark = pool.acquire();
      spark.x = i;
      pool.release(spark);
    }
    expect(pool.size).toBe(1);
    expect(pool.free).toBe(1);
  });

  it('reports what is out as size minus free', () => {
    const pool = new Pool(sparkOptions());
    const held = [pool.acquire(), pool.acquire(), pool.acquire()];
    expect(pool.size - pool.free).toBe(3);

    const first = held[0];
    if (first !== undefined) pool.release(first);

    expect(pool.size - pool.free).toBe(2);
  });
});

describe('Pool capacity', () => {
  it('throws a RangeError naming the capacity when max is reached', () => {
    const pool = new Pool({ ...sparkOptions(), max: 64 });
    for (let i = 0; i < 64; i += 1) pool.acquire();

    expect(() => pool.acquire()).toThrow(RangeError);
    expect(() => pool.acquire()).toThrow(
      'pool.acquire: exhausted at capacity 64; raise `max` or release before acquiring',
    );
  });

  it('lets an acquire through again after a release', () => {
    const pool = new Pool({ ...sparkOptions(), max: 1 });
    const only = pool.acquire();
    expect(() => pool.acquire()).toThrow(RangeError);

    pool.release(only);

    expect(pool.acquire()).toBe(only);
  });

  it('is unbounded when max is omitted', () => {
    const pool = new Pool(sparkOptions());
    for (let i = 0; i < 5000; i += 1) pool.acquire();
    expect(pool.size).toBe(5000);
  });

  it('rejects a max that is not an integer of at least one', () => {
    expect(() => new Pool({ ...sparkOptions(), max: 0 })).toThrow(
      'pool: expected `max` to be an integer >= 1, got 0',
    );
    expect(() => new Pool({ ...sparkOptions(), max: -4 })).toThrow(RangeError);
    expect(() => new Pool({ ...sparkOptions(), max: 1.5 })).toThrow(
      'pool: expected `max` to be an integer >= 1, got 1.5',
    );
    expect(() => new Pool({ ...sparkOptions(), max: Number.NaN })).toThrow(RangeError);
    expect(() => new Pool({ ...sparkOptions(), max: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('rejects a create that is not a function', () => {
    const options = { create: undefined as unknown as () => Spark };
    expect(() => new Pool(options)).toThrow(TypeError);
    expect(() => new Pool(options)).toThrow(
      'pool: expected `create` to be a factory function, got undefined',
    );
  });
});

describe('Pool.preallocate', () => {
  it('builds instances up front', () => {
    const pool = new Pool(sparkOptions());
    pool.preallocate(64);

    expect(pool.size).toBe(64);
    expect(pool.free).toBe(64);

    pool.acquire();
    expect(pool.size).toBe(64);
    expect(pool.free).toBe(63);
  });

  it('accepts the initial option as the same thing', () => {
    const pool = new Pool({ ...sparkOptions(), initial: 8 });
    expect(pool.size).toBe(8);
    expect(pool.free).toBe(8);
  });

  it('treats zero as a no-op', () => {
    const pool = new Pool({ ...sparkOptions(), initial: 0 });
    pool.preallocate(0);
    expect(pool.size).toBe(0);
  });

  it('adds to what already exists', () => {
    const pool = new Pool(sparkOptions());
    pool.preallocate(2);
    pool.preallocate(3);
    expect(pool.size).toBe(5);
  });

  it('rejects a count that is not a non-negative integer', () => {
    const pool = new Pool(sparkOptions());
    expect(() => pool.preallocate(-1)).toThrow(
      'pool.preallocate: expected a non-negative integer count, got -1',
    );
    expect(() => pool.preallocate(2.5)).toThrow(RangeError);
    expect(() => pool.preallocate(Number.NaN)).toThrow(
      'pool.preallocate: expected a non-negative integer count, got NaN',
    );
  });

  it('refuses to overshoot max, naming both numbers', () => {
    const pool = new Pool({ ...sparkOptions(), max: 64, initial: 32 });
    expect(() => pool.preallocate(100)).toThrow(
      'pool.preallocate: 100 more instances would exceed capacity 64 (32 already created)',
    );
    expect(() => pool.preallocate(32)).not.toThrow();
    expect(pool.size).toBe(64);
  });

  it('refuses an initial larger than max at construction', () => {
    expect(() => new Pool({ ...sparkOptions(), max: 4, initial: 10 })).toThrow(RangeError);
  });

  /**
   * CORE-4, and non-negotiable 9: an error names the caller's mistake.
   *
   * The constructor delegates `initial` to `preallocate`, and the delegation used to leak the
   * callee's name — a caller who wrote `initial: -1` was told about `pool.preallocate`, a
   * method that appears nowhere in their code and a word that appears nowhere in their
   * options. The assertion that bites is the `not.toContain`: a message can perfectly well
   * name `initial` and still name the wrong thing beside it, and only one of those two halves
   * was ever wrong.
   *
   * The direct-call message is unchanged and is still pinned three tests above; that is why
   * the fix is a label parameter and not an edit to `preallocate`'s own message.
   */
  it('reports a bad initial under the constructor, never under preallocate', () => {
    for (const message of [
      messageOf(() => new Pool({ ...sparkOptions(), initial: -1 })),
      messageOf(() => new Pool({ ...sparkOptions(), initial: 2.5 })),
      messageOf(() => new Pool({ ...sparkOptions(), max: 4, initial: 10 })),
    ]) {
      expect(message).toContain('initial');
      expect(message).not.toContain('preallocate');
    }
  });

  it('says what was wrong with the initial, not only where', () => {
    expect(messageOf(() => new Pool({ ...sparkOptions(), initial: -1 }))).toBe(
      'new Pool({ initial }): expected a non-negative integer count, got -1',
    );
    expect(messageOf(() => new Pool({ ...sparkOptions(), max: 4, initial: 10 }))).toBe(
      'new Pool({ initial }): 10 more instances would exceed capacity 4 (0 already created)',
    );
  });

  /**
   * The label is a parameter and not a constructor-only secret, because the next caller to
   * need it is a game that grows its own pool and wants the mistake filed under its name.
   */
  it('lets a caller name its own pool', () => {
    const pool = new Pool({ ...sparkOptions(), max: 4 });
    expect(messageOf(() => pool.preallocate(-1, 'sparks.grow'))).toBe(
      'sparks.grow: expected a non-negative integer count, got -1',
    );
    expect(messageOf(() => pool.preallocate(10, 'sparks.grow'))).toBe(
      'sparks.grow: 10 more instances would exceed capacity 4 (0 already created)',
    );
  });
});

describe('Pool double-release detection', () => {
  it('throws with a message that explains the symptom, when checked', () => {
    const pool = new Pool({ ...sparkOptions(), checked: true });
    const spark = pool.acquire();
    pool.release(spark);

    expect(() => pool.release(spark)).toThrow(TypeError);
    expect(() => pool.release(spark)).toThrow(
      "pool.release: this instance is already free — a double release hands one object to two callers, and each then sees the other's writes",
    );
    expect(pool.free).toBe(1);
  });

  it('is off by default, because it is O(n) per release', () => {
    const pool = new Pool(sparkOptions());
    const spark = pool.acquire();
    pool.release(spark);

    expect(() => pool.release(spark)).not.toThrow();
    // And this is exactly the corruption the flag exists to catch: two callers, one object.
    expect(pool.acquire()).toBe(pool.acquire());
  });

  it('allows the same instance to be released again after it has been acquired again', () => {
    const pool = new Pool({ ...sparkOptions(), checked: true });
    const spark = pool.acquire();
    pool.release(spark);
    expect(pool.acquire()).toBe(spark);
    expect(() => pool.release(spark)).not.toThrow();
  });

  it('checks against every free instance, not just the last', () => {
    const pool = new Pool({ ...sparkOptions(), checked: true });
    const a = pool.acquire();
    const b = pool.acquire();
    pool.release(a);
    pool.release(b);

    expect(() => pool.release(a)).toThrow(TypeError);
  });
});
