/**
 * Identity for a simulated world.
 *
 * Routed here from `core`, which will not hold a counter because layer 0 has no module-level
 * mutable state. Accepted: `sim` owns the shape of a simulated world, and a game that has to
 * invent this reaches for `Math.random()` or `Date.now()` — both banned by the constitution, and
 * neither of which replays.
 *
 * **Across a save/load boundary:** the counter is saved *with* the entities, in the same write,
 * and restored before any id is minted or narrowed. An {@link IdSource} is JSON-shaped
 * (`{ next: 3417 }`) and belongs in the game's state next to the ledger. Ids themselves survive as
 * the integers they are; nothing about them is derived from the session, which is what makes a
 * v1→v2 migration that turns `lampsLit: number` into `lamps: EntityId[]` writable at all — the
 * migration mints the ids it needs and writes the counter it left off at.
 *
 * Isomorphic and Tier A: integer addition and comparison, nothing else.
 */

import { expectSafeInteger } from '@latticekit/core';

declare const entityBrand: unique symbol;

/**
 * An identity for a thing in the world — a lamp, a building, a pilgrim with a name.
 *
 * A `number` at runtime and in JSON; branded so that a lamp id cannot be passed where a tile index
 * is wanted. The one cast that constructs one lives inside {@link mintId}, and the one that
 * re-narrows a saved integer lives inside {@link asEntityId}. There is deliberately no third.
 */
export type EntityId = number & { readonly [entityBrand]: true };

/**
 * The allocator. Its entire state is one integer, and that integer **must be saved**.
 *
 * `next` is deliberately mutable: this is the one value in the package that is not a value. A
 * counter that is not persisted alongside the entities it named will re-issue live ids on the next
 * session and merge two entities into one — silently, and unrecoverably.
 */
export interface IdSource {
  next: number;
}

/**
 * Start or restore an allocator.
 *
 * @param next - The counter read back from a save, or `0` for a new world.
 * @throws RangeError if `next` is not a non-negative safe integer — a corrupt save, caught at load
 *   rather than at the first mint. Above 2⁵³ a double cannot hold consecutive integers, so `n + 1`
 *   quietly equals `n` and the allocator stops allocating while appearing to work.
 */
export function createIdSource(next = 0): IdSource {
  expectSafeInteger(next, 'sim.createIdSource: next');
  if (next < 0) {
    throw new RangeError(
      `sim.createIdSource: next must be >= 0, got ${String(next)} — the counter only ever moves forward, so a negative one is a save that was written by something else`,
    );
  }
  return { next };
}

/**
 * Take the next id. Monotone, and **never reused**.
 *
 * Recycling a freed id is the ABA bug in a game: a reference held to a lamp that was extinguished
 * silently becomes a reference to the lamp built afterwards, and the symptom appears three systems
 * away. At one mint per millisecond a counter reaches `Number.MAX_SAFE_INTEGER` in 285,000 years,
 * so there is nothing to reclaim.
 *
 * Deterministic by construction: ids are handed out in the order actions are applied, so a replay
 * from a seed and an input log mints the same ids for the same things. That is why the counter is
 * here and not derived from a clock or an `Rng` — a time-derived id cannot replay, and a random one
 * would consume a stream the rest of the game is also drawing from.
 *
 * @throws RangeError if the source's counter has left the exactly-representable integers.
 */
export function mintId(source: IdSource): EntityId {
  expectSafeInteger(source.next, 'sim.mintId: source.next');
  const id = source.next;
  source.next = id + 1;
  return id as EntityId;
}

/**
 * Narrow a number that came back from a save.
 *
 * Ids arrive from `JSON.parse` as plain numbers, so a load boundary needs exactly one checked cast
 * — and that check is worth having for its own sake: **an id at or above `source.next` is proof the
 * counter was not saved with the entities.** That save will re-issue live ids and merge two
 * entities into one, which is unrecoverable and silent. Fail at load instead.
 *
 * @param label - the caller's symbol, for the error message: `'save.lamps[3]'`.
 * @throws RangeError naming the id and the counter it exceeded.
 */
export function asEntityId(value: number, source: IdSource, label: string): EntityId {
  expectSafeInteger(value, label);
  if (value < 0) {
    throw new RangeError(`${label}: expected a non-negative entity id, got ${String(value)}`);
  }
  if (value >= source.next) {
    throw new RangeError(
      `${label}: entity id ${String(value)} is at or above the allocator's next id (${String(source.next)}) — the counter was not saved with the entities, and minting from here would hand this id out a second time`,
    );
  }
  return value as EntityId;
}
