/**
 * The migration chain: the only version number in the system.
 *
 * A save format's version is not a constant a build declares and a chain then tries to keep
 * up with — it *is* the head of the chain. `createStore` reads it off `chain.head`, so
 * "declaring 7 while shipping a chain that ends at 6" is not a bug you can write down.
 *
 * The chain is proven to have no holes three times over: at compile time, because `step`'s
 * `to` is typed `Increment<Head>`; at construction, because `seal()` re-walks the rungs for
 * callers who arrived from JavaScript; and in a test, because only a test can catch a rung
 * that exists and is *wrong*.
 *
 * The trap this replaces, from the game this kit was extracted from: `parsed.version ===
 * SAVE_VERSION`, with a fallback to `createGame()` for everything else. That is not a
 * migration policy. It is a delete, and its own source said so — *"a bump is not a migration
 * — it is a deletion of every player's campus."*
 */

/**
 * `N + 1`, at the type level, so a chain that skips a version does not compile.
 *
 * Counting with a tuple caps out around 999, which is roughly 990 more save formats than any
 * game has ever shipped. Past that the compiler reports an excessively deep instantiation and
 * you have a different problem.
 */
export type Increment<N extends number, Counter extends readonly unknown[] = []> = Counter['length'] extends N
  ? [...Counter, unknown]['length'] & number
  : Increment<N, [...Counter, unknown]>;

/**
 * How a version recognizes itself: **returns the value typed, or throws.**
 *
 * Not `(value: unknown) => value is T`. A boolean predicate has already discarded the thing
 * that was wrong by the time it returns, so it cannot produce the message house rule 9
 * demands — it can only ever say "no". This is the same shape `@latticekit/core`'s `guard`
 * module took for the same reason, and it composes directly with it:
 *
 * ```ts
 * import { expectObject, expectRecordOfFinite } from '@latticekit/core';
 *
 * const isV2: Recognize<V2> = value => {
 *   const o = expectObject(value, 'save.v2');
 *   return { version: 2, wallet: expectRecordOfFinite(o['wallet'], 'save.v2.wallet') };
 * };
 * ```
 *
 * That example compiles, and `test/migrate.test.ts` runs it verbatim — see the note on
 * examples in `index.ts` about why that matters.
 *
 * Note the bracket access. `expectObject` returns `Record<string, unknown>`, and the repo
 * builds with `noPropertyAccessFromIndexSignature`, so `o.wallet` does not compile and
 * `o['wallet']` does. The guards that take a `number` (`expectFinite`, `expectSerializable`)
 * cannot be handed an `unknown` straight from `JSON.parse` without a cast; reach for the
 * `unknown`-accepting ones (`expectObject`, `expectRecordOfFinite`) on the save path, and
 * check a lone scalar with a `typeof` of your own until `core` widens the others.
 *
 * Two things fall out of returning rather than asserting. The thrown message travels into
 * `ReadFailure.message`, so a rejected save says *which field* was wrong instead of "the
 * guard said no" — the difference between a fixable bug report and a shrug. And a recognizer
 * may **normalize as it validates**, returning a repaired value, which is the cheapest
 * possible migration for a field that only ever needed a default.
 *
 * There is no optional variant, no default `v => v as T`, and no "skip validation in
 * production" flag. It is also not an assertion function: build tools strip those, which
 * would leave the check running only where it is least needed.
 *
 * Make it as loose as you can defend. Checking the two or three fields your migration
 * actually reads beats a field-by-field validator nobody maintains — but do check that your
 * currencies are finite (`expectSerializable`), because `Infinity` serializes to `null` and
 * comes back as `NaN` with a perfectly valid checksum.
 */
export type Recognize<T> = (value: unknown) => T;

/** One rung, for reporting and for tests. `why` is prose a reviewer reads, not a label. */
export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly why: string;
}

/**
 * A sealed chain from `floor` to `head` with no gaps.
 *
 * `head` is carried in the type, which is how `createStore` knows the current version without
 * being told it twice.
 */
export interface MigrationChain<Head extends number, T> {
  /**
   * The oldest version still readable. A save older than this reads as `orphaned` —
   * deliberate, announced data loss, which is why the floor is an argument and never
   * inferred. Raising it should be a commit of its own with the number in the message.
   */
  readonly floor: number;
  readonly head: Head;
  readonly steps: readonly MigrationStep[];
  /**
   * The head recognizer. `store.decode` runs it last; a throw becomes `invalid`, carrying the
   * thrown message.
   */
  recognize(value: unknown): T;
  /**
   * Run `value` from version `from` up to `head`, one rung at a time, recognising at every
   * version on the way.
   *
   * **Throws** — the only throwing function in the package — because a migration is game code
   * and can do anything. `store.decode` is the caller that wraps it and turns the throw into
   * a `migration-failed` failure naming the rung. Exported so a test can drive a fixture
   * through the chain without a store.
   *
   * @param from the version `value` is currently at. Must be an integer in
   *   `[floor, head]`; anything else is a caller error and throws `RangeError`, because a
   *   store has already turned an out-of-range version on disk into `orphaned` or `future`
   *   before it gets here.
   * @param onEnter called with each version as the chain arrives at it — `from` first, then
   *   every version up to and including `head` — *before* that version's recognizer runs.
   *   It exists for exactly one caller: `store.decode` catches the throw and needs to name
   *   the rung, and the alternative was for `run` to wrap game code's exception in one of its
   *   own, which would put a wrapper where `ReadFailure.cause` promises the original. A test
   *   driving a fixture ignores it.
   */
  run(value: unknown, from: number, onEnter?: (version: number) => void): T;
}

/** The chain under construction. `migrations()` starts one; `seal()` ends it. */
export interface ChainBuilder<Head extends number, Current> {
  /**
   * Add the rung `Head → Head + 1`. `to` is typed `Increment<Head>`, so
   * `migrations(1, isV1).step(3, …)` fails to compile with
   * `Argument of type '3' is not assignable to parameter of type '2'`.
   *
   * `migrate` receives the previous version *typed*, because the previous version was
   * recognized by its own recognizer before it was handed over. That is the whole reason a
   * recognizer is mandatory rather than optional: without it a migration reads `unknown` and
   * every line in it is a cast.
   *
   * There is no 3 → 7 shortcut and there will not be one. A shortcut means two paths from 3
   * to 7 and only one of them is ever exercised; the untested one is the path a player's
   * four-year-old save takes.
   *
   * @param why prose a reviewer reads — *"one coin counter became a wallet of currencies"*,
   *   not `"v2"`. It is carried on `steps` and is what a future agent has instead of the
   *   commit that added it.
   * @throws TypeError if `migrate` or `recognize` is not a function, or `why` is empty. A
   *   developer error at construction, which is a different moment from a player's save at
   *   boot and is allowed to be loud.
   */
  step<Next extends Increment<Head>, Migrated>(
    to: Next,
    why: string,
    migrate: (prior: Current) => Migrated,
    recognize: Recognize<Migrated>,
  ): ChainBuilder<Next, Migrated>;
  /**
   * Freeze. Re-checks the chain at runtime for callers who arrived from JavaScript or through
   * an `any`, and throws `RangeError` naming the missing version.
   *
   * A hole caught here is a developer error at construction. A hole caught at decode time
   * would present as a player losing a save, which is why this exists at all.
   *
   * @throws RangeError if the rungs do not form `floor → head` in steps of exactly one.
   */
  seal(): MigrationChain<Head, Current>;
}

/** A rung with its functions attached. Private: `MigrationStep` is the reported half. */
interface Rung {
  readonly from: number;
  readonly to: number;
  readonly why: string;
  readonly migrate: (prior: unknown) => unknown;
  /** The recognizer for `to` — this rung's *output*, and the next rung's input. */
  readonly recognizeOutput: Recognize<unknown>;
}

/** One version on the path: how to recognize it, and how to leave it. */
interface Stage {
  readonly version: number;
  readonly recognize: Recognize<unknown>;
  readonly migrate: (prior: unknown) => unknown;
}

/**
 * Start a chain at the oldest version you still support, with the recognizer for that version.
 *
 * Every version has a recognizer, mandatory, including the floor. That is how `migrate`
 * receives a typed argument instead of `unknown`: a chain of migrations that each begin with
 * a cast is not a chain, it is a stack of hopes.
 *
 * @param floor the oldest readable version. Raising it is a decision to abandon every save
 *   below it; make it in a commit of its own with the number in the message.
 * @throws RangeError if `floor` is not an integer, TypeError if `recognize` is not a
 *   function.
 */
export function migrations<Floor extends number, T>(floor: Floor, recognize: Recognize<T>): ChainBuilder<Floor, T> {
  if (!Number.isInteger(floor)) {
    throw new RangeError(`migrations: expected an integer floor version, got ${String(floor)}`);
  }
  if (typeof recognize !== 'function') {
    throw new TypeError(
      `migrations: expected a recognizer function for version ${String(floor)}, got ${String(recognize)} — every version has one, including the floor, or a migration reads \`unknown\``,
    );
  }
  return builder<Floor, T>(floor, recognize, [], floor);
}

/** The builder is immutable: `step` returns a new one, so a chain may be branched in a test. */
function builder<Head extends number, Current>(
  floor: number,
  floorRecognise: Recognize<unknown>,
  rungs: readonly Rung[],
  headVersion: number,
): ChainBuilder<Head, Current> {
  return {
    step<Next extends Increment<Head>, Migrated>(
      to: Next,
      why: string,
      migrate: (prior: Current) => Migrated,
      recognize: Recognize<Migrated>,
    ): ChainBuilder<Next, Migrated> {
      if (typeof migrate !== 'function' || typeof recognize !== 'function') {
        throw new TypeError(
          `migrations.step(${String(to)}): expected a migrate function and a recognizer, got ${String(migrate)} and ${String(recognize)}`,
        );
      }
      if (typeof why !== 'string' || why.trim() === '') {
        throw new TypeError(
          `migrations.step(${String(to)}): expected prose saying why this rung exists, got ${String(why)} — a reviewer in two years has this and nothing else`,
        );
      }
      // The cast erases `Current`, which the runtime never needed: the value reaching
      // `migrate` was produced by the previous stage's recognizer, so it is a `Current` by
      // construction. Parameter contravariance is the only reason a cast is written here.
      const erased = migrate as (prior: unknown) => unknown;
      return builder<Next, Migrated>(
        floor,
        floorRecognise,
        [...rungs, { from: headVersion, to, why, migrate: erased, recognizeOutput: recognize }],
        to,
      );
    },

    seal(): MigrationChain<Head, Current> {
      let expected = floor;
      for (const rung of rungs) {
        if (!Number.isInteger(rung.to)) {
          throw new RangeError(
            `persist: migration chain rung ${String(rung.from)} → ${String(rung.to)} is not an integer version`,
          );
        }
        if (rung.to === rung.from + 1) {
          expected = rung.to;
          continue;
        }
        if (rung.to > rung.from + 1) {
          throw new RangeError(
            `persist: migration chain jumps ${String(rung.from)} → ${String(rung.to)}; version ${String(rung.from + 1)} has no migration — a shortcut means two paths to the head and only one of them is ever exercised`,
          );
        }
        throw new RangeError(
          `persist: migration chain steps backwards ${String(rung.from)} → ${String(rung.to)}; a rung must go up exactly one version`,
        );
      }

      const head = expected as Head;
      const steps: readonly MigrationStep[] = rungs.map(
        (rung): MigrationStep => ({ from: rung.from, to: rung.to, why: rung.why }),
      );

      // Walk once, at seal, so `run` is a loop over a flat array rather than an index
      // arithmetic problem. `stages` holds one entry per *rung* — the head has no rung, and
      // its recognizer is held separately because it is the only one whose type survives.
      const stages: Stage[] = [];
      let recogniseHere: Recognize<unknown> = floorRecognise;
      for (const rung of rungs) {
        stages.push({ version: rung.from, recognize: recogniseHere, migrate: rung.migrate });
        recogniseHere = rung.recognizeOutput;
      }
      // The last recognizer added is the head's, and it is a `Recognize<Current>` by
      // construction: `step` fixed `Current` to its own `Migrated` on the way past. The array
      // above erased that, and this is the one place it is claimed back.
      const recogniseHead = recogniseHere as Recognize<Current>;

      return {
        floor,
        head,
        steps,
        recognize: recogniseHead,
        run(value: unknown, from: number, onEnter?: (version: number) => void): Current {
          if (!Number.isInteger(from) || from < floor || from > head) {
            throw new RangeError(
              `chain.run: expected a version in [${String(floor)}, ${String(head)}], got ${String(from)}`,
            );
          }
          let current: unknown = value;
          for (const stage of stages) {
            if (stage.version < from) continue;
            onEnter?.(stage.version);
            current = stage.migrate(stage.recognize(current));
          }
          onEnter?.(head);
          return recogniseHead(current);
        },
      };
    },
  };
}
