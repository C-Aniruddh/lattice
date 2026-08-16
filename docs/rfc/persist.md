# RFC — `@lattice/persist`

> Status: proposed. Owner: architect. Implements to `.lattice/kit.json → packages.persist`.
> Nothing in this document is implemented yet. A builder should be able to write the package
> from it without asking a question.
>
> **Amends `.lattice/kit.json`:** yes. Modules become
> `["store", "migrate", "adapters", "integrity", "replay", "browser"]` — two more than declared.
> `replay` is accepted ownership of the kit's headline claim (§4.9); `browser` is the one
> DOM-shaped module. Routed in §8 because this file is the only one I own.
>
> **The architect brief's six sections, in its order:** the one sentence (§1), the five-line
> example (§2), the public surface (§3), what is deliberately absent (§5), the invariants (§6),
> the traps (§7). §4 argues the decisions the surface encodes — four of them settle seams other
> RFCs asked about — and §8 routes what belongs elsewhere.

---

## 1. The one sentence

**`@lattice/persist` keeps a player's game across a version bump, a crashed tab and a browser
that lies about its storage — by making the save an explicitly versioned envelope, the upgrade
an explicit chain of one-step migrations, and every failure a reported value instead of a
thrown exception on boot.**

Two consequences fall straight out of that sentence and shape everything below.

- **The storage adapter is injected.** `localStorage` is named in exactly one function in this
  package, and that function takes the storage object as a parameter. The whole package —
  chain, envelope, checksum, coalescing, quarantine — runs and tests in Node with no shims.
- **The read path never throws.** Boot is the one moment a game cannot recover from an
  exception, because there is no UI yet to show it in. Every read outcome, including the seven
  ways a save can be unusable, is a field on a returned object.

---

## 2. The five-line example

This is the 90% case: a game with a save format now on its second version, running in a
browser. It is written before the API below, and the API exists to serve it.

```ts
import { migrations, createStore, browserStorage, installFlushTriggers } from '@lattice/persist';

const chain = migrations(1, isV1)
  .step(2, 'one coin counter became a wallet of currencies', v1 => ({ version: 2, wallet: { coin: v1.coins } }), isV2)
  .seal();
const store = createStore({ key: 'campus', chain, adapter: browserStorage(), fresh: newGame, now: () => Date.now() });
const opened = store.open();                       // never throws. `opened.failure` says why if it degraded
const auto = store.autosave(() => game.state, { schedule: loop.real.after });
installFlushTriggers(auto, { visibility: document, page: window });
```

`opened.state` is always a playable state. The store writes at most once per four seconds and
once more on the way out of the page. `now` is the game's calendar (§4.8) and there is no
default for it; `schedule` is the game's timer (§4.6) and if you have no scheduler, call
`auto.tick()` from whatever advances your simulation instead.

Read what the example does *not* contain, because each absence is a decision:

| not in the example | because |
|---|---|
| a `version: 2` option | the chain **is** the version. `createStore` reads the head off the chain, so declaring 7 and shipping a chain that ends at 6 is not expressible. |
| a `validate` option | validation is per-version, inside the chain. There is one concept, not two. |
| `try` / `catch` | there is nothing to catch. `open()` returns a result. |
| `await` | the adapter is synchronous, deliberately. See §4.1. |
| a timer | this package owns no timer and creates none. `schedule` is injected — `loop.real.after` in a browser, something synchronous in a test. See §4.6. |
| a clock | the same. `now` is injected, required, and has no default, because reading one here would break non-negotiable #1 and defaulting one would silently zero every offline gap. See §4.8. |
| `localStorage` | `browserStorage()` reaches for it behind a guard and degrades to memory. It is the only place the word appears. |

---

## 3. The public surface

Six modules: `integrity`, `adapters`, `migrate`, `store`, `replay`, `browser`. The block below
type-checks as written under the repo's `tsconfig.base.json` strictness, DOM lib present or
absent.

### 3.1 Integrity

```ts
/**
 * A checksum over the exact payload text.
 *
 * **A 32-bit digest detects corruption. It does not authenticate, and pretending otherwise
 * is worse than having none at all.** It catches a truncated write, a string clipped by a
 * quota limit, a sync extension that half-wrote the key, and a payload hand-edited into
 * invalid state — the class of damage that otherwise loads as a subtly wrong world three
 * sessions later. It cannot stop a determined player: the algorithm is in the bundle they
 * downloaded, there is no key, and recomputing it in a devtools console takes under a
 * minute. If your game's economy needs a save the player cannot edit, your game needs a
 * server, and this kit deliberately does not have one.
 *
 * Collision maths, stated so nobody has to guess: 32 bits is a birthday collision at roughly
 * 77,000 distinct inputs, and one specific damaged payload passes with probability 2^-32.
 * For "did these bytes survive the round trip" that is ample; for anything adversarial it is
 * meaningless, because an adversary does not need a collision, they need a calculator.
 */
export type Checksum = (text: string) => string;

/**
 * `hashString` from `@lattice/core`, rendered as eight lowercase hex digits.
 *
 * Deliberately not a bespoke CRC or FNV implementation: `core` split `hash` into its own
 * module precisely so `persist`, `draw` and `iso` would not each grow a private 32-bit hash.
 * One implementation, one set of tests, one portability seam.
 *
 * The payload is checksummed **as read, unnormalised**. `hashString` walks UTF-16 code units,
 * so NFC and NFD spellings of the same text hash differently — and that is correct here,
 * because they are different bytes and the checksum's whole job is to notice that the bytes
 * changed. Do not "fix" this by normalising before hashing: it would make the digest cover a
 * string that was never written.
 */
export declare const defaultChecksum: Checksum;
```

### 3.2 Adapters

```ts
/** The shape of `localStorage` and `sessionStorage`, structurally, so neither is imported. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Where a save goes. Synchronous on purpose — see §4.1.
 *
 * An adapter never throws: it swallows what the platform throws and reports through its
 * return. `set` failing is normal (quota, private mode) and the store turns it into a
 * `WriteResult`, not an exception in a `pagehide` handler where nothing can be done anyway.
 */
export interface StorageAdapter {
  /**
   * Whether writes are expected to outlive the tab. `false` for the memory fallback.
   *
   * Surfaced on `OpenResult` so a game can tell a private-mode player once, at the start,
   * that progress will not be kept — which is useful — rather than saying nothing and
   * letting them discover it after two hours, which is what silence buys you.
   */
  readonly durable: boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Wraps any `StorageLike`. This is the seam: pass `localStorage`, `sessionStorage`, a
 *  same-origin iframe's storage, or a fake with four methods in a test. */
export declare function webStorage(storage: StorageLike): StorageAdapter;

/** An in-process map. `durable: false`. The default adapter in every test in the kit, and
 *  the fallback `browserStorage()` returns when the platform has no usable storage. */
export declare function memoryStorage(seed?: Readonly<Record<string, string>>): StorageAdapter;

/**
 * `localStorage` if the platform will give it up, memory if it will not. **The only mention
 * of `localStorage` in this package.**
 *
 * Private-mode Safari has historically thrown on the *property access*, not merely on
 * `setItem`, so the guard has to wrap the read of `globalThis.localStorage` itself; a
 * try/catch around `setItem` alone still takes the page down at module scope. A player whose
 * browser refuses storage still gets to play. They just do not get to come back to it, and
 * `durable` says so.
 */
export declare function browserStorage(scope?: { readonly localStorage?: StorageLike }): StorageAdapter;
```

### 3.3 The migration chain

```ts
/**
 * `N + 1`, at the type level, so a chain that skips a version does not compile.
 *
 * Counting with a tuple caps out around 999, which is roughly 990 more save formats than any
 * game has ever shipped.
 */
export type Increment<N extends number, Counter extends readonly unknown[] = []> =
  Counter['length'] extends N ? ([...Counter, unknown]['length'] & number) : Increment<N, [...Counter, unknown]>;

/**
 * How a version recognises itself: **returns the value typed, or throws.**
 *
 * Not `(value: unknown) => value is T`. A boolean predicate has already discarded the thing
 * that was wrong by the time it returns, so it cannot produce the message non-negotiable #9
 * demands — it can only ever say "no". This is the same shape `@lattice/core`'s `guard`
 * module took for the same reason, and it composes directly with it:
 *
 * ```ts
 * const isV2: Recognise<V2> = v => {
 *   const o = expectObject(v, 'save.v2');
 *   return { version: 2, wallet: expectRecordOfFinite(o['wallet'], 'save.v2.wallet') };
 * };
 * ```
 *
 * Two things fall out of returning rather than asserting. The thrown message travels into
 * `ReadFailure.message`, so a rejected save says *which field* was wrong instead of "the
 * guard said no" — the difference between a fixable bug report and a shrug. And a recogniser
 * may **normalise as it validates**, returning a repaired value, which is the cheapest
 * possible migration for a field that only ever needed a default.
 *
 * No schema language, because a schema language is a dependency and this kit has none. Make
 * it as loose as you can defend: checking the two or three fields your migration actually
 * reads beats a field-by-field validator nobody maintains.
 */
export type Recognise<T> = (value: unknown) => T;

/** One rung, for reporting and for tests. `why` is prose a reviewer reads, not a label. */
export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly why: string;
}

/**
 * A sealed chain from `floor` to `head` with no gaps, proven three ways (§4.3).
 *
 * `head` is carried in the type, which is how `createStore` knows the current version without
 * being told it twice.
 */
export interface MigrationChain<Head extends number, T> {
  /** The oldest version still readable. A save older than this is `orphaned` — deliberate,
   *  announced data loss, which is why the floor is an argument and never inferred. */
  readonly floor: number;
  readonly head: Head;
  readonly steps: readonly MigrationStep[];
  /** The head recogniser. `store.decode` runs it last; a throw becomes `invalid`, carrying
   *  the thrown message. */
  recognise(value: unknown): T;
  /**
   * Run `value` from version `from` up to `head`, one rung at a time.
   *
   * **Throws** — the only throwing function in the package — because a migration is game code
   * and can do anything. `store.decode` is the caller that wraps it and turns the throw into a
   * `migration-failed` failure naming the rung. Exported so a test can drive a fixture through
   * the chain without a store.
   */
  run(value: unknown, from: number): T;
}

export interface ChainBuilder<Head extends number, Current> {
  /**
   * Add the rung `Head → Head + 1`. `to` is typed `Increment<Head>`, so
   * `migrations(1, isV1).step(3, …)` fails to compile with
   * `Argument of type '3' is not assignable to parameter of type '2'`.
   *
   * `migrate` receives the previous version *typed*, because the previous version was
   * recognised by its own recogniser before it was handed over. That is the whole reason a
   * recogniser is mandatory rather than optional: without it a migration reads `unknown` and
   * every line in it is a cast.
   */
  step<Next extends Increment<Head>, Migrated>(
    to: Next,
    why: string,
    migrate: (prior: Current) => Migrated,
    recognise: Recognise<Migrated>,
  ): ChainBuilder<Next, Migrated>;
  /** Freeze. Re-checks the chain at runtime for callers who arrived from JavaScript, and
   *  throws `RangeError` naming the missing version. Developer error, thrown loudly, at
   *  construction — which is not the boot path a player's save travels. */
  seal(): MigrationChain<Head, Current>;
}

/**
 * Start a chain at the oldest version you still support, with the recogniser for that version.
 *
 * @param floor the oldest readable version. Raising it is a decision to abandon every save
 *              below it; make it in a commit of its own with the number in the message.
 */
export declare function migrations<Floor extends number, T>(
  floor: Floor,
  recognise: Recognise<T>,
): ChainBuilder<Floor, T>;
```

### 3.4 The envelope and the read result

```ts
/**
 * What is actually on disk. Five short keys, because this string is re-encoded every four
 * seconds for the life of a session.
 *
 * `d` is the payload as a **JSON string**, not a nested object, for two reasons that are
 * worth the double encoding:
 *   1. the checksum then covers the exact bytes read, not a re-serialisation of a parse. A
 *      checksum computed over `JSON.stringify(JSON.parse(text))` is a checksum of your
 *      serialiser's key ordering, and it will pass over damage and fail over nothing;
 *   2. `v` stays readable when `d` is garbage. Detecting a save from the *future* must not
 *      require parsing a payload written by a build that no longer exists.
 * Use `inspect()` rather than eyeballing it in devtools.
 */
export interface Envelope {
  /** Save format version. */
  readonly v: number;
  /** When it was written, in epoch ms, read from the store's injected `now` — this package
   *  has no clock of its own. The only timestamp in the format. §4.8. */
  readonly t: EpochMillis;
  /** Write sequence, monotonic per key. Only used for cross-tab conflict detection (§4.4). */
  readonly n: number;
  /** `checksum(d)`. */
  readonly c: string;
  /** The game's state, JSON-encoded. */
  readonly d: string;
}

/** Every way a save can fail to become a state. Closed union; a reviewer can count the branches. */
export type FailureReason =
  /** Storage itself refused to be read. Private mode, a disabled setting, an I/O error. */
  | 'unreadable'
  /** Not JSON, or JSON that is not an envelope. Something else wrote to this key. */
  | 'malformed'
  /** Checksum mismatch, or the payload did not parse though the envelope did. Damaged bytes. */
  | 'corrupt'
  /** `v` is above the chain head: the player has opened an older deploy. See §4.2 — this one
   *  is not the player's fault and must not cost them their save. */
  | 'future'
  /** `v` is below the chain floor: a save from before the versions this build still carries. */
  | 'orphaned'
  /** A migration threw, or a step's recogniser rejected its own output. `atVersion` names the
   *  rung and `message` carries what the recogniser said was wrong. */
  | 'migration-failed'
  /** Migrated to the head and the head recogniser still threw. The chain has a bug, or
   *  something else has been writing this key. */
  | 'invalid';

/**
 * The report. **This is what "reported" means: a value, not a log line and not a thrown error.**
 *
 * The package never renders text at a player, never calls `console`, and never phones home.
 * It hands the game a record the game can log, count, put behind a debug panel, or show as
 * "we could not read your save" in its own voice — and that a test can assert on exactly.
 */
export interface ReadFailure {
  readonly reason: FailureReason;
  /** House rule 9: names the caller's mistake in prose, e.g.
   *  `persist: save "campus" is version 9 but this build reads up to 7 — the player has an
   *  older deploy. Storage was left untouched and this store will not write.` */
  readonly message: string;
  /** The version on disk, or `null` when the envelope was not readable at all. */
  readonly savedVersion: number | null;
  /** For `migration-failed`, the rung that threw. `null` otherwise. */
  readonly atVersion: number | null;
  readonly savedAt: number | null;
  /** Whether the offending text was kept (§4.5). `false` if quarantine is off, if the text was
   *  never read, or for `future` — which is never quarantined because it is never destroyed. */
  readonly quarantined: boolean;
  /** Whatever was thrown, unchanged. `unknown` because a migration can throw a string. */
  readonly cause: unknown;
}

export interface OpenResult<T> {
  /** Always a playable state. `fresh()` was called if the save did not survive. */
  readonly state: T;
  readonly source: 'save' | 'fresh';
  /** True only when storage held nothing. `source: 'fresh'` with `firstRun: false` is a save
   *  that was lost, and a game that treats the two the same will never notice it is losing them. */
  readonly firstRun: boolean;
  /** The version read from disk, when it was below the head and migrated up. */
  readonly migratedFrom: number | null;
  /** When the loaded save was written. What offline accrual is measured from — and it can be in
   *  the *future* if the device clock moved; see the trap in §6.7. */
  readonly savedAt: number | null;
  /** False when this store refuses to write over what it found. Today that is `future` only. */
  readonly writable: boolean;
  /** From the adapter. False means this session will not be there tomorrow. */
  readonly durable: boolean;
  /** Non-null exactly when `source === 'fresh' && !firstRun`. */
  readonly failure: ReadFailure | null;
}
```

### 3.5 The store

```ts
/** Why a write did not happen. Not errors — three of these are the store working correctly. */
export type WriteSkip = 'closed' | 'not-writable' | 'too-soon' | 'conflict' | 'too-large';

export interface WriteFailure {
  readonly reason: 'quota' | 'unavailable';
  readonly message: string;
  readonly cause: unknown;
}

export interface WriteResult {
  readonly written: boolean;
  readonly bytes: number;
  readonly skipped: WriteSkip | null;
  readonly error: WriteFailure | null;
}

/** A save that could not be read, kept so a bug report can carry it. §4.5. */
export interface Rejected {
  readonly failure: ReadFailure;
  readonly text: string;
  readonly truncated: boolean;
}

/** From `@lattice/core`. Reproduced so this block stands alone; the implementation imports it. */
type EpochMillis = number;
/** From `@lattice/core`. The game's calendar: wall-clock milliseconds since the epoch. */
type Now = () => EpochMillis;

/** Undo a scheduled callback. Calling it twice is not an error. */
export type Cancel = () => void;

/**
 * Run `fn` after `afterMs` have passed, and hand back a way to cancel it.
 *
 * Injected, never created. `persist` may not import `@lattice/loop` — they are siblings on
 * layer 1 and the DAG forbids the edge — and it may not reach for `setTimeout`, because a
 * package that creates a timer is a package that owns a leak. A browser game passes
 * `loop.real.after`; a Node test passes a function that runs `fn` immediately or on a queue it
 * controls, and every coalescing test then finishes in microseconds with no fake timers.
 */
export type Schedule = (afterMs: number, fn: () => void) => Cancel;

/**
 * What is wrong with this store right now, as a **condition rather than a message**.
 *
 * `@lattice/ui` latches player-facing notices on this value, so the contract is narrow and
 * strict:
 *
 * - **It is stable while the condition is.** A bare member of this union, always. It never
 *   carries a timestamp, an attempt count, a byte size or a version number. Interpolating a
 *   detail would defeat the latch in exactly the case the latch exists for — the autosave
 *   rediscovers full storage every four seconds, and a status that differs each time is shown
 *   each time. The details live on `lastWrite`, `rejected()` and `OpenResult.failure`, where a
 *   game reads them when it wants them; the status is the key, not the payload.
 * - **It is readable the moment `open()` returns**, before a single `tick`. The newer-save case
 *   has to reach a player whose session has not started, and a report about a session that is
 *   not running must not depend on the session running.
 * - **One value, most severe first**, in the order listed below. `refusing-newer` masks
 *   `not-persistent` and that is correct rather than a compromise: a store that is refusing to
 *   write has nothing to say about whether its writes would have survived.
 */
export type StoreStatus =
  /** Reading and writing normally. The overwhelmingly common value. */
  | 'ok'
  /**
   * A save exists that this build cannot read and must not overwrite (§4.2). Nothing is being
   * written and nothing this session will survive.
   *
   * Set by `open()`, cleared only by `reset()` or by opening a store that no longer finds a
   * newer save. **What the player loses by missing it: the entire session, silently.**
   */
  | 'refusing-newer'
  /**
   * Writes are being attempted and rejected — quota, or storage revoked mid-session. Set on a
   * failed write, cleared by the next successful one, so it is stable exactly as long as the
   * condition is.
   *
   * **What the player loses by missing it: everything since the last successful write**, which
   * grows for as long as they keep playing.
   */
  | 'write-failing'
  /**
   * The adapter is not durable — private mode, or storage refused at boot. The session plays
   * and will not be there tomorrow.
   *
   * **What the player loses by missing it: this session, once they close the tab.** Known at
   * boot, and it never changes for the life of the store.
   */
  | 'not-persistent';

export interface StoreOptions<Head extends number, T> {
  /**
   * The storage key, and with it the lifetime. **One store, one key, and no store ever reads
   * or writes another store's key** — which is what makes progress, settings and replays
   * genuinely independent rather than independent by convention. See §4.10.
   *
   * The convention the demo game uses and this RFC recommends:
   * `campus:save`, `campus:settings`, `campus:replay:<id>`, plus `campus:save:rejected` which
   * the store manages itself. Save slots are separate stores on separate keys; there is no
   * slot concept and there does not need to be one.
   */
  readonly key: string;
  readonly chain: MigrationChain<Head, T>;
  readonly adapter: StorageAdapter;
  /** A brand-new game. Called on first run and on every degraded read. Must not throw — if this
   *  throws, boot is over and there is nothing left to degrade to. */
  readonly fresh: () => T;
  /**
   * The game's calendar. **Required, with no default, deliberately** — see §4.8.
   *
   * `persist` stamps `savedAt` and cannot read a clock of its own: `Date.now` is banned inside
   * every package's `src/` and the linter enforces it. Defaulting this to `() => 0` would be
   * the worst bug this package could ship, because every save would load with an elapsed time
   * of zero, offline progress would silently pay out nothing, and *nothing would look broken*.
   * A missing argument is a compile error; a zeroed timestamp is a support ticket in eight
   * months.
   */
  readonly now: Now;
  /**
   * Floor on the interval between coalesced writes. Default 4000.
   *
   * Four seconds is the number the source game shipped. Below about one second you are paying
   * a synchronous serialise plus a storage write on a phone, per second, forever; above about
   * ten a crash costs a visible amount of progress.
   */
  readonly minWriteIntervalMs?: number;
  /** What to do when another tab has written since we last did. Default `'last-write-wins'`,
   *  which is free — `'refuse'` costs one extra read per write. §4.4. */
  readonly conflict?: 'last-write-wins' | 'refuse';
  /** Default `defaultChecksum`, which is `core`'s `hashString`. */
  readonly checksum?: Checksum;
  /** Keep unreadable saves under `${key}:rejected`. Default on, capped at 64 kB. §4.5. */
  readonly quarantine?: false | { readonly maxBytes?: number };
  /** Refuse to write an envelope larger than this rather than discover the quota by throwing.
   *  Default 1_000_000. A save near this is a design problem this package cannot fix. */
  readonly maxBytes?: number;
  /** Called once, during `open`/`decode`, with the same record the result carries. For a
   *  counter or a breadcrumb — the result is the source of truth. */
  readonly onFailure?: (failure: ReadFailure) => void;
  /** Called on a failed write. Expect it more than once: quota does not heal. */
  readonly onWriteError?: (failure: WriteFailure) => void;
}

/**
 * A coalescing write handle bound to one getter. `store.autosave` makes it; `store.reset` and
 * `store.close` kill it.
 */
export interface AutosaveOptions {
  /**
   * The timer, injected. When supplied, the handle re-arms itself after every write and you
   * never call `tick`.
   *
   * Prefer this to polling: a `tick` driven by the simulation stops when the simulation stops,
   * and a paused or backgrounded game still owes the player the last four seconds of progress.
   * Whatever you pass must keep firing in a hidden tab — `setInterval` does, `requestAnimationFrame`
   * is 0 Hz and does not.
   */
  readonly schedule?: Schedule;
}

export interface Autosave {
  /**
   * The polling form, for a game with no scheduler. Writes iff `minWriteIntervalMs` has passed
   * since the last write, reading the instant from the store's injected `now`.
   *
   * **Returns a boolean, not a result object** (house rule 7): this is called for the life of
   * the session and an object per call is a GC pause with a pleasant signature. The detail of
   * the last write that actually happened is on `lastWrite`.
   *
   * Do not drive it from `requestAnimationFrame`: rAF is 0 Hz in a hidden tab, and a save that
   * stops when the tab is backgrounded is a save that never survives the tab being closed.
   * A no-op when `schedule` was supplied, so wiring both is harmless rather than a double write.
   */
  tick(): boolean;
  /** Write now if anything is owed, ignoring the interval. What the visibility handler calls. */
  flush(): WriteResult;
  /** The last write this handle attempted, or `null`. One object per real write, not per tick. */
  readonly lastWrite: WriteResult | null;
  /** Detach and cancel any scheduled write. Idempotent. A stopped handle's `tick` and `flush`
   *  are no-ops reporting `'closed'` — which is half of why the reset in trap §7.2 actually works. */
  stop(): void;
}

export interface Store<T> {
  readonly key: string;
  /** The chain head. There is no other version number in the system. */
  readonly version: number;
  readonly phase: 'new' | 'open' | 'closed';
  readonly writable: boolean;
  /**
   * The current condition, safe to read on every frame and every `update` (§4.11).
   *
   * A plain property returning a string literal: no allocation, no event subscription, no
   * disposer to leak. `ui` polls it, latches on it, and decides for itself what a given
   * condition is worth interrupting a player for — which is the correct division, because this
   * package cannot know what the player is in the middle of.
   */
  readonly status: StoreStatus;
  /** Read storage and produce a state. Never throws, for any content whatsoever. Calling it
   *  twice re-reads; calling it after `reset()` reopens the store. */
  open(): OpenResult<T>;
  /**
   * `open()` minus the adapter: the entire read pipeline as a function of a string.
   *
   * This is the testing seam. A fixture file per historical version, run through `decode`, is
   * the regression test that the chain still reaches the head (§4.3, invariant §6.4).
   */
  decode(text: string): OpenResult<T>;
  /** The envelope text for `state`, exactly as `save` would write it. A backup or share-code
   *  button is this plus the game's own encoding of choice. */
  encode(state: T): string;
  /** Write now, unconditionally, subject only to `writable` and `phase`. */
  save(state: T): WriteResult;
  autosave(get: () => T, options?: AutosaveOptions): Autosave;
  /**
   * **A real reset.** In order: close the store to writes, stop every autosave handle it has
   * created, remove the key and the quarantine key, return a fresh state.
   *
   * The ordering is the whole point. `localStorage.clear()` followed by a reload does *not*
   * reset a game — the live autosave flushes on `pagehide` and writes the state back over the
   * clear. The source game lost real time to this (trap §7.2) and its fix was a hand-rolled
   * `window.foom.reset()`. Here it is the API: after `reset()` returns, no code path in this
   * package writes to the adapter until `open()` is called again. That is invariant §6.2, and
   * it is testable without a browser.
   */
  reset(): T;
  /** Tear down. Pass a getter to flush on the way out; pass nothing to close silently — which
   *  is what a "delete my save" button wants and what `reset` does internally. */
  close(options?: { readonly flush?: false } | { readonly flush: true; readonly get: () => T }): void;
  /** The last save this store could not read, if quarantine kept it. For a debug panel or a
   *  bug-report payload. */
  rejected(): Rejected | null;
  clearRejected(): void;
}

/** Throws `RangeError`/`TypeError` on nonsense options — a developer error at construction,
 *  which is a different moment from a player's save at boot and is allowed to be loud. */
export declare function createStore<Head extends number, T>(options: StoreOptions<Head, T>): Store<T>;

/** The envelope only, payload untouched, or `null` if this is not one. For tools, debug panels,
 *  and the `future` check that must work without parsing a payload it cannot understand. */
export declare function inspect(text: string): Envelope | null;

/**
 * Milliseconds between the loaded save and now — the offline gap, and the one derived
 * quantity this package will compute for you. See §4.8 for why it exists at all.
 *
 * Returns `0` when there is nothing to measure (`firstRun`, or a degraded read), which is the
 * correct elapsed time for a game that has just begun. Clamped at zero from below, because a
 * player who changes their device date produces a `savedAt` in the future and a negative
 * elapsed is not a thing `sim` should have to defend against.
 *
 * **Not clamped from above.** An offline cap is a balance decision — how much of eight hours
 * away a game chooses to pay out — and it belongs to `sim`, not here. This function reports
 * the gap; `sim` decides what it is worth.
 *
 * Read `OpenResult.savedAt` directly if you want to detect the backwards clock and say
 * something about it.
 */
export declare function elapsedSince(opened: OpenResult<unknown>, now: EpochMillis): number;
```

### 3.6 Replay

The kit's headline claim, made falsifiable. `AGENTS.md` #1 promises that a session replays from
a seed and an input log and lands on the same pixel; §4.9 argues why the envelope, the recorder
and the divergence check live here, which half of the job does not, and — the sharpest rule in
this package — why a replay is the **one thing here that is never migrated**.

```ts
/** From `@lattice/core`. Reproduced so this block stands alone; the implementation imports it. */
interface RngSnapshot { readonly seed: number; readonly state: number }

/**
 * The only three fields this package reads out of a recorded input log.
 *
 * `@lattice/input` owns the log's shape and `persist` may not import it — input is layer 2 and
 * this is layer 1, so the edge does not exist. This structural constraint is therefore the
 * entire coupling between them: three fields, compared for exact equality, never interpreted.
 * Everything else about a log is opaque here and is stored verbatim (§4.9).
 */
export interface ReplayCompat {
  /** The input log's own format version. */
  readonly version: number;
  /** The fixed step the session was recorded at. A replay driven at a different step is a
   *  different simulation, however similar it looks. */
  readonly stepMs: number;
  /** The gesture/binding profile in force. A tap threshold that moved turns one recorded
   *  pointer stream into a different sequence of actions. */
  readonly profile: string;
}

/**
 * "The same pixel", reduced to a uint32.
 *
 * The game supplies it because only the game knows what is canonical: the wallet and the
 * building list, probably; a camera position and a tween phase, definitely not, or every replay
 * diverges the first time somebody scrolls. Build it from `core`'s `hashParts`.
 */
export type Digest<T> = (state: T) => number;

/** Eight bytes. The interval between them trades log size against how tightly a divergence can
 *  be bracketed — a checkpoint every ten seconds means "somewhere in these 600 ticks". */
export interface Checkpoint {
  readonly tick: number;
  readonly digest: number;
}

/**
 * A recorded session: a starting stream, an input log, and the digests that make the claim
 * checkable.
 *
 * Stored in the same envelope as everything else — it wants `v`, `t` and `c` for identity and
 * integrity — but under the **opposite version policy**. See §4.9: a replay store's chain has
 * no rungs, so an old replay is `orphaned` rather than migrated, and that is correct.
 */
export interface ReplayLog<L extends ReplayCompat> {
  /** The kit build this was recorded under. A divergence against an unknown build is
   *  unattributable, and an unattributable divergence report is theatre. */
  readonly kit: string;
  /** The game's own build identity, however the game versions itself. */
  readonly game: string;
  /** The stream the session started from, **cursor included** — not just the seed. A log that
   *  restores a seed but not the cursor re-rolls every draw the session had already spent, and
   *  it looks correct for the first few draws, which is what makes it expensive. */
  readonly rng: RngSnapshot;
  readonly startTick: number;
  readonly endTick: number;
  /**
   * The input log, **verbatim**. Never rewritten, never normalised, never migrated.
   *
   * `stepMs` and `profile` live in here rather than being copied up to this level, deliberately:
   * a duplicated field is a field that can disagree with itself, and the copy that disagrees is
   * always the one the check reads.
   */
  readonly inputs: L;
  /** Ascending by tick. */
  readonly checkpoints: readonly Checkpoint[];
}

export interface RecorderOptions<T> {
  readonly kit: string;
  readonly game: string;
  readonly rng: RngSnapshot;
  readonly startTick: number;
  readonly digest: Digest<T>;
  /** Ticks between checkpoints. Default 600 — ten seconds at 60 Hz. */
  readonly checkpointEvery?: number;
}

/**
 * Records checkpoints, and nothing else.
 *
 * It does not record inputs: `@lattice/input` already keeps a per-tick bucketed log keyed by an
 * integer tick index, and a second recorder here would be a second copy of the same data with
 * its own ordering bugs. The game hands that log over once, at `stop`.
 */
export interface Recorder<T> {
  /**
   * Advance to `tick`, taking a checkpoint if one is due. Returns whether it took one.
   *
   * **A boolean, not a result object** (house rule 7): this is called every tick for the whole
   * session, and `digest` runs only on the ticks that actually checkpoint.
   */
  mark(tick: number, state: T): boolean;
  readonly checkpointCount: number;
  /** Take a final checkpoint and seal the log around the input log you pass in. Idempotent. */
  stop<L extends ReplayCompat>(tick: number, state: T, inputs: L): ReplayLog<L>;
}

export declare function createRecorder<T>(options: RecorderOptions<T>): Recorder<T>;

/**
 * Why a replay was not run. **A refusal is never a pass**, and the field that differed is named
 * because "incompatible" sends someone reading five things to find out which one.
 */
export type Refusal =
  | {
      readonly kind: 'mismatch';
      readonly field: 'kit' | 'game' | 'log-version' | 'stepMs' | 'profile';
      readonly recorded: string | number;
      readonly current: string | number;
    }
  | { readonly kind: 'no-checkpoints' };

export interface Divergence {
  /** The checkpoint tick where the digests first disagreed. */
  readonly tick: number;
  /** The last tick known to agree. **The bug is between these two numbers** — which is the
   *  entire value of a checkpoint interval, and why the report leads with the bracket. */
  readonly lastAgreedTick: number;
  readonly expected: number;
  readonly actual: number;
  readonly checkpointIndex: number;
}

export interface ReplayVerdict {
  readonly matched: boolean;
  readonly checkpointsChecked: number;
  /** The **first** divergence only. Every later one is a consequence of this one, and reporting
   *  them is noise that buries the line that matters. */
  readonly divergence: Divergence | null;
  /** Non-null means the replay was declined before it started. `matched` is then `false`, never
   *  `true` — a verifier that reported green because it had refused to check is exactly how a
   *  determinism claim rots into a slogan. */
  readonly refused: Refusal | null;
}

export interface ReplayVerifier<T> {
  /** Compare at `tick` if a checkpoint is due there. Returns `false` once it has diverged or
   *  refused, so a driver can stop immediately rather than run an hour of ticks past the answer. */
  mark(tick: number, state: T): boolean;
  finish(): ReplayVerdict;
}

/**
 * Build the verifier for a log, against **this** build's identity and input configuration.
 *
 * The compatibility check is exact equality on five values and runs before the first tick. It is
 * not a migration and there is no coercion: see §4.9.
 */
export declare function createVerifier<T, L extends ReplayCompat>(
  log: ReplayLog<L>,
  current: {
    readonly kit: string;
    readonly game: string;
    /** The current build's log format, step and profile — usually read off a freshly created
     *  input log rather than typed out, so the two cannot drift. */
    readonly inputs: ReplayCompat;
    readonly digest: Digest<T>;
  },
): ReplayVerifier<T>;
```

### 3.7 Browser wiring

The only module that knows a browser exists, and it knows through parameters. It compiles
without the DOM lib and tests in Node against two objects with `addEventListener`.

```ts
export interface ListenerTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FlushTargets {
  /** `document`, structurally. */
  readonly visibility: ListenerTarget & { readonly visibilityState: string };
  /** `window`, structurally. */
  readonly page: ListenerTarget;
}

/**
 * Flush on the events that actually fire, and return a disposer.
 *
 * Binds `visibilitychange` (flushing only when `visibilityState === 'hidden'`) and `pagehide`.
 * **Not `beforeunload`.** Mobile Safari does not reliably deliver `beforeunload`; a save that
 * only runs on unload silently loses the session for a meaningful share of players, and they
 * are the share on the platform where sessions end by the phone being pocketed rather than by
 * a tab being closed. `visibilitychange` fires when the app is backgrounded, which is the
 * moment that actually corresponds to "the player has stopped playing".
 *
 * The returned disposer removes both listeners. It does **not** flush — a disposer that writes
 * is the mechanism behind the reset trap in §7.2.
 */
export declare function installFlushTriggers(autosave: Autosave, targets: FlushTargets): () => void;

/** The kit version this package was built as part of. */
export declare const VERSION: string;
```

---

## 4. Decisions, argued

### 4.1 The adapter is synchronous, and that is the load-bearing choice

An async adapter would admit IndexedDB, OPFS, and a server, and it would cost the only write
that genuinely matters. The browser does not await a promise during `pagehide`; a page being
discarded runs your synchronous work and drops the rest. Making the primary store async means
the last four seconds of every session are a coin flip.

So: sync everywhere, no promises in the surface, no async state machine, and no question about
what happens if a flush is in flight when `reset()` is called. A game that wants IndexedDB
writes a mirror on top of `encode()` and treats it as a backup, not as the store.

### 4.2 A save from the future is not the player's fault

The player opened a stale deploy — a cached `index.html`, a service worker, a second device on
an old build, a CDN edge that has not caught up. Their v9 save is fine. The v7 build cannot
read it.

Degrading to fresh here is correct *in memory* and catastrophic *on disk*: the old build would
autosave four seconds later and overwrite a good save with an empty campus. So `future` is the
one reason that also sets **`writable: false`**, and the store refuses every write until it is
opened again. Storage comes out of the session byte-identical (invariant §5.6).

The game's job is then to say something — "this save was made by a newer version of the game;
reload to get it" — and, if the player insists on starting over anyway, call `reset()`, which
is the deliberate, one-line escape hatch. Nothing else can get past a non-writable store, which
is the point.

`future` is also never quarantined: quarantine copies text, and there is nothing to preserve
here because nothing is being destroyed.

### 4.3 Proving the chain has no holes, three ways

| when | mechanism | what a hole looks like |
|---|---|---|
| compile | `step`'s `to` is typed `Increment<Head>`, and `createStore` takes the version off the chain head | `Argument of type '3' is not assignable to parameter of type '2'` |
| construction | `seal()` re-walks the rungs for callers arriving from JavaScript or through an `any` | `RangeError: persist: migration chain jumps 4 → 6; version 5 has no migration` |
| test | a fixture per historical version through `store.decode`, asserting `outcome`, `migratedFrom`, and the head recogniser | `decode(fixtures['v3'])` returns `failure.reason: 'migration-failed'` at a named rung |

The first two make a hole unwritable. Only the third catches a rung that exists and is *wrong*,
which is the failure that actually ships, so it is not optional: **the kit's own demo game keeps
one fixture per version from the floor up, and adding a rung without adding a fixture should
fail lint.** That last clause is a change to `tools/lint` and is routed in §8.

Design notes on the chain itself:

- **`to === from + 1`, always. No 3→7 shortcut.** A shortcut means two paths from 3 to 7 and
  only one of them is ever exercised; the untested one is the path a player's four-year-old
  save takes.
- **Every version has a recogniser, mandatory, including the floor.** This is how `migrate`
  receives a typed argument instead of `unknown`. A chain of migrations that each begin with a
  cast is not a chain, it is a stack of hopes. And because a recogniser *returns* the value
  rather than answering yes/no, a rejection arrives with the field name in it.
- **The floor is an argument, never inferred.** Raising it deletes saves below it. That should
  take a commit whose message says so.

### 4.4 Two tabs: detection is in scope, resolution is not

The problem is real and cost the source game time: two tabs on the same origin share one key,
and whichever one's `pagehide` fires last wins — including over a reset performed in the other.

**In scope:** the envelope carries `n`, a monotonic write sequence. With `conflict: 'refuse'`
the store re-reads `n` before each write, and if storage has advanced past what it last wrote,
it stops writing, reports `WriteSkip: 'conflict'`, and lets the game say "this game is open in
another tab". This costs one adapter read per write and is off by default, because the default
is what every shipped game does and the cost should not be paid by games that do not need it.

**Deliberately not in scope: leader election.** No `BroadcastChannel`, no Web Locks, no merge.
Stated loudly in §4.7 and repeated here: **if two live tabs are a real case for your game, you
need a lock, and you will build it yourself.** The reason is not laziness. Web Locks is not
available everywhere this kit runs, `BroadcastChannel` does not tell you the holder was killed
rather than closed, and a lock that leaks on a crashed tab locks a player out of their own game
permanently. A half-lock is worse than no lock, because with no lock the loser merely overwrites
and with a half-lock the winner cannot play at all. Detection plus an honest `'conflict'` skip
is the largest correct thing this package can do without a primitive it does not have.

### 4.5 What "reported" means, concretely

Three tiers, because a lost save is the failure a game most needs to hear about and most often
does not.

1. **A value on the result.** `OpenResult.failure` is a structured record with a closed reason
   union. It is what a test asserts on and what a game switches over. The package renders no
   text at a player and writes nothing to `console` — a library that logs is a library that is
   noisy in someone else's product.
2. **The evidence is kept.** The unreadable text is copied to `${key}:rejected` alongside the
   failure record, capped at 64 kB with a `truncated` flag, and readable through
   `store.rejected()`. Degrading to fresh without keeping the bytes destroys the only copy of
   the bug that just ate a player's campus; a support conversation then consists of two people
   guessing. One key, one slot, overwritten each time, `clearRejected()` to drop it.
3. **A hook for counting.** `onFailure` fires once per failed read, for a metric or a
   breadcrumb. It is a convenience: the result is the source of truth, and a game that ignores
   the hook loses nothing.

The reason `firstRun` is a separate field from `source` exists for this: a game that cannot
distinguish "new player" from "player whose save we destroyed" will report a healthy funnel
while quietly losing people.

### 4.6 The store owns no timer, and does not create one

The debounced write and `loop.real` are the same feature seen twice, and this package cannot
import `loop` — they are siblings on layer 1 and the DAG forbids the edge. The resolution is not
to reimplement it: **`Schedule` is injected.** A browser game passes `loop.real.after`, a Node
test passes a function that queues callbacks it can run by hand, and `setTimeout` never appears
in `src/`.

That removes the last reason this package would need anything global, which is what keeps it
isomorphic and completely testable: invariant §6.13 asserts that with a recording `schedule`, no
write happens until the test chooses to run one. A coalescing test is then a few function calls,
not a fake timer library.

`tick()` remains for a game with no scheduler at all — a poll cannot leak a timer and needs no
cancellation semantics, so it is the smaller thing to fall back to. When both are wired, `tick`
is a no-op rather than a double write.

One obligation falls on whatever is passed as `schedule`, and both forms state it: **it must
keep firing in a hidden tab.** rAF is 0 Hz when the tab is backgrounded, so an rAF-backed
scheduler stops saving at precisely the moment a player is most likely to close the tab. A
simulation-driven `tick` has the same failure if the simulation pauses, which is the reason
`schedule` is the recommended form and not merely an alternative.

### 4.7 This package owns the envelope. It does not own your schema — but it names who does

Take the position plainly: **`@lattice/persist` owns `{ v, t, n, c, d }`, the chain, the
coalescing and the failure taxonomy. It has no opinion about the shape of `d`.** It cannot: the
kit forbids dependencies, so there is no schema library here, and a schema DSL written in-house
would be a bigger package than this one.

What it refuses to do is let the obligation go unnamed. **You cannot register a version without
supplying the predicate that recognises it.** The schema lives in the game; its *validation* is
a required argument at the boundary. That gives every guarantee that matters at the seam —
`decode` never hands the game a state the game itself did not vouch for — with none of the
weight of owning a type system.

The consequence a builder must not soften: `Recognise<T>` has no optional variant, no default
`v => v as T`, and no "skip validation in production" flag. It is also not an assertion
function — build tools strip those, which would leave the check running only where it is least
needed.

---

### 4.8 The saved-at seam, stated precisely

Three packages can each reasonably assume another owns this number, so here is this side of it
with no hedging.

| question | answer |
|---|---|
| does the envelope carry it? | **Yes.** `Envelope.t`, integer epoch milliseconds. It is the only timestamp in the format. |
| who stamps it? | **The caller. Always.** This package may not read a clock — non-negotiable #1 bans `Date.now` inside `src/` and the linter enforces it — so `persist` stamps *what it is given* and never a default. |
| how is forgetting made impossible? | `now: Now` is a **required, non-optional field of `StoreOptions` with no default**. `createStore` cannot be called without it, so a store that has no calendar does not exist. This was verified, not assumed: dropping `now` from the §2 example fails to compile. Defaulting it to `() => 0` would be the worst bug in this package's reach — every save would load with an elapsed of zero, offline progress would pay out nothing, and nothing would *look* broken. |
| what reads it back? | `OpenResult.savedAt: number | null` — the instant on disk, unmodified, including a value in the future. `null` **only** when no save was loaded (`firstRun`, or any degraded read). |
| what computes the gap? | `elapsedSince(opened, now): number` — `now - savedAt`, clamped at zero below, `0` when there is nothing to measure. |
| why one calendar rather than a parameter per call? | Six required parameters are six chances to thread the wrong number in; one required construction argument is one. `loop` has explicitly refused the timestamp (it has no epoch), so the calendar is game-owned and passed to both this package and `sim` — one function, two consumers, no disagreement possible. |
| in what unit? | Milliseconds, integer, epoch. `persist` does not convert to seconds, does not apply a warp, and does not cap. |

The division of labour that follows, for the orchestrator to check the other two RFCs against:

- **`loop` owns the clock.** It is where `now()` comes from and the only package entitled to
  decide what "now" means. `persist` takes it as an argument.
- **`persist` owns the record.** It is the one place that unambiguously knows the moment a save
  was written, because it is the code that wrote it. It stamps and reports; it does not
  interpret.
- **`sim` owns the meaning.** Offline accrual, the cap on how much time away pays out, and the
  warp are balance decisions. `elapsedSince` hands `sim` a non-negative number of milliseconds
  and stops there.

The two clamps are split on purpose and the split is the interesting part. The **lower** clamp
lives here because a negative elapsed is a *correctness* failure — a device clock moved
backwards, and every consumer would otherwise have to defend against it separately. The
**upper** clamp lives in `sim` because it is a *balance* number: "eight hours of offline
progress" is a design decision, and a persistence layer that picked one would be making a game
design choice on the game's behalf. If `sim`'s RFC does not clamp above, that is a real hole and
it is `sim`'s hole, not this one's.

### 4.9 Replay: accepted, with the boundary drawn along the DAG

The kit's front page promises a session replays from a seed and an input log. Nothing owned
that, which made the claim unfalsifiable — the worst state for a kit selling determinism,
because it is either the best feature or a lie and nothing decides which. `core` proposed this
package and the reasoning holds: **a replay is a save with a different payload.** It needs a
version (a replay without the build it was recorded under is unattributable), a migration chain
(reading an old replay *is* a migration), integrity (a divergence check is a checksum asking a
different question), and an envelope. All four are already here, and taking it costs about a
dozen exports rather than a package.

The boundary matters as much as the acceptance, and the dependency graph draws it. `persist` is
layer 1 and depends only on `core`; it may not import `input` (layer 2) or `loop` (its sibling).
So:

Three packages converged on this seam without coordinating — `core` proposed the owner, `input`
built a per-tick bucketed log keyed by an integer tick index, and `loop` already has a manual
clock driven flat out, which *is* a replay. That is the strongest available evidence that the
seam is real rather than invented here.

**This package owns** the `ReplayLog` envelope, the checkpoint recorder, and the verifier that
compares digests and reports the first divergence with a bracket around it. All three are pure
functions of data and need nothing but `core`.

**This package does not own the input log.** `input` does, and `persist` stores it **verbatim** —
which necessarily means opaquely. `ReplayLog<L extends ReplayCompat>` reads exactly three fields
out of it and interprets none of them. The consequence, taken deliberately rather than
reluctantly: **the cursor that plays a log back cannot live here either**, because a package that
cannot see inside a structure cannot iterate it. It belongs to whoever owns the shape, which is
`input`, and it is routed in §8. This costs two exports and buys a boundary that is checked by
the compiler instead of by discipline.

**This package does not own the driver** — constructing a game, restoring the rng snapshot,
turning the fixed-step crank. That needs `loop`, which `persist` may not import. `persist` hands
over a log and a verifier; `loop` turns the crank. Routed in §8.

#### A replay is evidence. Evidence is never migrated.

Everything above this section argues that a save must survive at almost any cost: an explicit
chain, a rung per version, a floor you lower only on purpose. **A replay takes the opposite
policy, and a reader arriving from §4.3 will assume otherwise, so it is stated here as a
contrast rather than left to be inferred.**

A save is a player's progress, and progress that cannot be read is a loss the player feels. A
replay is *evidence*, and evidence that has been migrated is no longer evidence. A session
recorded at a 16.667 ms step and replayed at 20 ms will not land on the same pixel; a session
recorded under a tap threshold of 8 px and replayed at 12 px turns one pointer stream into a
different sequence of actions. "Migrating" either would produce a **confident wrong answer**, and
a divergence report that cannot be trusted puts the determinism claim back where it started —
unfalsifiable — while looking like it has been tested. A refusal is strictly more useful than a
plausible lie.

So the policy inverts on all three axes:

| | **save** | **replay** |
|---|---|---|
| old format | migrated, rung by rung | **refused** — `orphaned` |
| mechanism | a chain with rungs from floor to head | a chain with **no rungs**: `migrations(N, isLog).seal()`, floor === head |
| near-miss | tolerated; a recogniser may normalise as it validates | **refused**, exactly: `version`, `stepMs` and `profile` are compared for equality and the differing field is named |
| failure costs | a player's campus | a test result nobody should have trusted |

The mechanism is worth noticing: **"never migrate" is expressible in the machinery already
specified, as a chain with zero rungs.** A replay store is a normal store whose chain has floor
equal to head, so a replay in an older format reads as `orphaned` — an existing failure reason,
already meaning "older than anything this build will read", already degrading without a throw.
No second code path, no exception to the read pipeline, and invariant §6.17 pins it.

The compatibility triple is checked in a second, separate place — `createVerifier`, before the
first tick — because the two refusals answer different questions. `orphaned` means *this build
cannot read the file*. A `Refusal` means *the file is readable and was recorded under conditions
this build does not reproduce*. Collapsing them would lose the distinction that tells you whether
to go and find an older build or go and fix the step.

One further deliberate limit: **checkpoints are digests, not states.** Storing states would make
a replay a save-scumming format and a hundred times larger, and would answer a question nothing
asked ("what did it look like") in place of the one that matters ("did it diverge").

### 4.10 Three lifetimes, one envelope

`audio` needs somewhere to keep per-bus gain and mute flags, and it is right that they are not
progress. Once `replay` landed here too, the package has three things to store with three
different lifetimes — and the question is whether that is three envelope types or one.

**One.** The reasoning, since it was asked for rather than the conclusion: the envelope has
never had an opinion about the payload. `d` is a string, `v` is the payload's version, and
everything in §3.4 and §3.5 — the chain, the checksum, the seven failure reasons, quarantine,
coalescing, the future-version lock — is a function of the envelope alone. Three bespoke
envelopes would be the same four fields written three times, three migration mechanisms, and
three places to get the `future` case wrong. `createStore` is already generic in its payload and
its chain; a settings store is `createStore` with a different key, a different chain and a
different `fresh`. That is the whole feature, and it exists today.

What was genuinely missing is the doctrine, so here it is, stated hard enough to test:

| | **save** | **settings** | **replay** |
|---|---|---|---|
| key | `game:save` | `game:settings` | `game:replay:<id>` |
| payload | the run | device preferences: volume, mute, reduced motion, colour-blind palette | a `ReplayLog` |
| written | coalesced, every 4 s, by an `Autosave` | immediately on change, via `save(state)` | once, at `stop()` |
| version policy | migrated, rung by rung | migrated, rung by rung | **never migrated** — a chain with no rungs, so an old one is `orphaned`. §4.9 |
| survives **START OVER** | no — that is what START OVER means | **yes** | yes |
| in an export | yes | **never** | separately, on purpose |
| `fresh()` returns | a new game | the **defaults**, which is a real answer and not a failure | n/a |

Three consequences a builder must not blur:

1. **`reset()` is scoped to one store, and a game's START OVER calls it on the save store only.**
   Resetting the settings store means "back to factory volume", which is a different button that
   most games do not have. `reset()` removes `key` and `${key}:rejected` and touches nothing
   else; there is no `resetEverything`, and the absence is deliberate (§5.13).
2. **An export contains exactly one store's payload.** `store.encode(state)` serialises the
   state you pass through that store's chain and checksum. It has no access to another key, so a
   save shared between two players cannot carry one of them's mute flag into the other's
   speakers. This is a structural guarantee, not a discipline, and invariant §6.11 tests it.
3. **The future-version lock is per store.** A save written by a newer deploy locks the save
   store (§4.2) and leaves the settings store writable, because a player stuck on a stale build
   should still be able to turn the volume down.

`audio` cannot reach this package — both are layer 1 with no edge — and it should not try. It
returns a plain versioned snapshot; the game passes that snapshot to a settings store it owns.
That indirection is the layering working, not the layering getting in the way.

### 4.11 Conditions, not messages — and severity is not ours to set

`ui` refused a dialog system and shipped two primitives instead: `acknowledge()`, one modal with
one button and no way past it, and `ToastHost.once(key, text)`, a session-scoped latch. Both need
an input, and the input is a **condition**, not a rendered string. `store.status` is it.

This package renders no text at a player, which has been true since §4.5, and it is worth saying
why once more now that something is actually consuming the result: a library that writes player-
facing prose writes it in one voice, one language and one register, and a game then has a
sentence in its UI that it cannot change without patching a dependency. `persist` reports what is
true. The game says it in its own words.

The observation `ui` sent back belongs in this document because it is really about these failure
modes: **severity is not a property of the message, it is a property of what the player loses by
missing it.** That is why `StoreStatus` documents the loss on every member rather than a
priority number, and it is why the mapping below is a recommendation to a game rather than a rule
this package enforces:

| status | what the player loses by missing it | fits |
|---|---|---|
| `refusing-newer` | the whole session, silently, and they cannot tell | `acknowledge()` — the correct action is to reload, and a notice that can be dismissed by accident is a notice that did not work |
| `write-failing` | everything since the last good write, growing | `acknowledge()` if it persists; the player is losing progress *now* |
| `not-persistent` | this session, when the tab closes | `ToastHost.once` — a first-time player must not be blocked behind a modal about a hypothetical |

Put the storage warning in a modal and a first-time player is stopped at the door by a dialog
about something that has not happened. Put the newer-save notice in a toast and it expires unread
while the player keeps building a campus that will not exist tomorrow — having been told, in a
way that did not work. The two mistakes are symmetrical and both come from ranking messages by
how alarming they sound rather than by what is actually at stake.

Two mechanical consequences for the builder:

1. **`status` is set inside `open()`, before it returns.** Not on the first tick, not on a
   microtask. `ui` has made `acknowledge()` work before the first `tick()` precisely so the
   newer-save case can be reported to a session that has not begun, and a status that only
   becomes true once the loop is running would waste that.
2. **`status` is stable while its condition is.** Repeated discovery of the same condition
   produces the same value, byte for byte. The failing test is easy to write and easy to forget:
   let the autosave hit a full quota twenty times and assert the status was the same string all
   twenty, so a latch keyed on it fires once.

## 5. What is deliberately absent

This section is the one that stops the next agent adding it back.

1. **Async adapters, and promises anywhere in the surface.** §4.1. The write that matters
   happens as the page dies, and the page does not await. A `Promise`-returning `save()` would
   look more modern and lose data.
2. **Cross-tab leader election.** No `BroadcastChannel`, no Web Locks, no merge, no CRDT.
   Detection only, opt-in, §4.4. **If your game must survive two live tabs, you are building the
   lock yourself and `conflict: 'refuse'` is the hook you build it on.**
3. **Encryption, obfuscation, signing, anti-tamper.** The checksum detects damage and says so in
   its own doc comment. A save the player cannot edit requires a server the player cannot edit,
   and this kit has no server by design. Shipping obfuscation would buy an afternoon against one
   player and a permanent false belief for the developer.
4. **Cloud sync, accounts, and conflict resolution across devices.** Same reason. The source
   game's non-negotiable was that the median visitor costs $0; a sync layer is the first thing
   that breaks that, and it is a product, not a module.
5. **A schema language or validator.** §4.7. Recognisers are functions, and `core`'s `guard`
   module already supplies the leaf validators. Zod is a dependency, and the second
   non-negotiable says there are none.
6. **A pluggable payload codec.** The envelope is always JSON. If the payload encoding were
   pluggable, a build that changed codecs could not read `v` off an old save to discover that it
   needed the old codec. The `d`-as-string design already gives a game room to put whatever it
   likes inside.
7. **Compression.** LZ-string is larger than this entire package and the budget is 12 kB gzipped.
   A game with a save big enough to need compression has a state-design problem that compressing
   it will hide for one release.
8. **Save slots, profiles, and named saves.** A slot is a second store on a second key. Growing a
   slot concept means growing a slot *index*, which means a second thing to migrate and a second
   thing to corrupt.
9. **Undo, rewind, and a ring buffer of snapshots.** This package took replay (§4.9) and
   deliberately took only part of it: its checkpoints are 8-byte digests. Storing states instead
   would make it a save-scumming format, a hundred times larger, and would answer a question
   ("what did it look like") that nothing asked, in place of the one that matters ("did it
   diverge").
10. **A migration chain for replays, and any coercion of a near-miss.** §4.9. A replay store's
    chain has no rungs by rule, and `version`/`stepMs`/`profile` are compared for exact equality.
    This is the one place in the package where refusing to read something is the *correct*
    behaviour, and a future agent tempted to "just migrate the old replays" should read the
    contrast table before touching it.
11. **The replay cursor, and the driver.** Also §4.9. `input` owns the log's shape so it owns
    iterating it; `loop` owns the crank. This package stores the log verbatim and can therefore
    see neither. Both are routed in §8, and if `loop` does not take the driver the recorder
    records sessions nobody replays.
12. **Timers, and a clock.** §4.6 and §4.8. Both are injected, both are required, and neither has
    a default — a defaulted clock is the single worst bug in this package's reach.
13. **Automatic or inferred migration** — "spread the new defaults over the old object". Every
    rung is a named function with a `why` a reviewer can read. See trap §7.6 for what the
    alternative actually costs.
14. **Version skipping.** No 3→7 rung. §4.3.
15. **A `resetEverything()` that clears the origin.** §4.10. It would be four lines and it would
    be wrong: it is the API shape of `localStorage.clear()`, which is trap §7.2, and the one
    thing a player resetting their game does *not* expect is their volume back at full at one in
    the morning. Reset the stores you mean, by name.
16. **A settings-store convenience wrapper.** Same reason as save slots: it would be
    `createStore` with three arguments pre-filled and a second name for one concept.

---

## 6. Invariants a reviewer can test

Each is phrased so the failing case is obvious. All run in Node against `memoryStorage()`.

1. **`open()` never throws.** Property test: for 1000 arbitrary strings written into the
   adapter — empty, `'null'`, `'{'`, valid JSON of the wrong shape, an envelope with `c`
   flipped, one megabyte of `'a'` — `open()` returns 1000 results and throws zero times.
   *Fails when:* any input escapes as an exception.
2. **`reset()` is final until `open()`.** Write a save, take an autosave handle, call `reset()`,
   then call `autosave.flush(now)`, `autosave.tick(now)`, `store.save(now, state)` and invoke
   the disposer from `installFlushTriggers`. The adapter's write count is unchanged and its
   `get(key)` is `null`. *Fails when:* the trap in §7.2 has been reintroduced.
3. **Round trip.** For any JSON-round-trippable `T`, `store.decode(store.encode(t, s))` yields
   `source: 'save'`, `migratedFrom: null`, `savedAt: t`, and a state deep-equal to `s`.
4. **The floor still reaches the head.** For every fixture from `chain.floor` to `head - 1`,
   `decode` returns `source: 'save'`, `migratedFrom` equal to the fixture's version, and a state
   the head recogniser accepts. *Fails when:* a rung was added or edited without its fixture.
5. **A hole is unconstructable.** `seal()` throws `RangeError` if and only if the rungs do not
   form `floor → head` in steps of one — and never at decode time, where a hole would present as
   a player losing a save.
6. **A future save is untouched.** Given an envelope at `head + 1`: `open()` returns
   `reason: 'future'`, `writable: false`, `firstRun: false`; then after any number of `tick`s,
   a `flush`, and a `save`, `adapter.get(key)` is byte-identical to what was there before.
   *Fails when:* a stale deploy can eat a good save.
7. **Corruption is caught before the payload is trusted.** Flip one character inside `d`:
   `reason: 'corrupt'`, and the payload is never parsed into a state. Flip one character inside
   the envelope's structure: `reason: 'malformed'`.
8. **Writes coalesce.** With `minWriteIntervalMs: 4000`, 240 ticks spread over 3999 ms produce
   exactly one write; the 241st tick at 4001 ms produces a second.
9. **Failures are values, not noise.** No path in `src/` calls `console`, and every degraded read
   populates `failure` with a `message` that names the key and the versions involved.
10. **The package is isomorphic and owns neither a clock nor a timer.** `src/` contains no
    reference to `localStorage`, `document`, `window`, `Date.now`, `performance.now`,
    `setTimeout`, `setInterval` or `requestAnimationFrame` — except `browserStorage`, which
    reaches for `localStorage` behind a guard, and that is one grep-able exception. The suite
    imports nothing browser-shaped and passes under plain `node`. *Fails when:* someone adds a
    default for `now` or `schedule` "so the tests are shorter".
11. **Stores are isolated.** Given a save store and a settings store on one adapter: writing,
    resetting or corrupting either leaves every key belonging to the other byte-identical, and
    `saveStore.encode(state)` produces a string containing none of the settings payload. *Fails
    when:* an exported save carries the exporter's volume into someone else's speakers.
12. **The timestamp is the caller's.** `createStore` with a `now` that returns a fixed 1000
    produces an envelope with `t: 1000`; there is no code path that produces a `t` the injected
    `now` did not return. And `elapsedSince(opened, now)` is `0` for a first run, `0` for a save
    stamped in the future, and exact otherwise. *Fails when:* offline progress silently pays out
    nothing because a default clock returned zero.
13. **Coalescing is driven, not timed.** With an injected `schedule` that records its callbacks
    instead of running them, no write happens until the test runs one — proving no real timer
    exists anywhere in the package.
14. **A replay verdict is never a false green.** For each of the five compatibility values in
    turn — `kit`, `game`, `inputs.version`, `inputs.stepMs`, `inputs.profile` — a log differing
    only in that one returns `matched: false` with `refused.field` naming exactly it, and
    `divergence` null. Five cases, five distinct names. *Fails when:* a verifier reports green
    because it declined to check, or reports "incompatible" without saying which field.
15. **Divergence is bracketed and first-only.** Given a driver that perturbs state at tick 900
    with checkpoints every 600: `divergence.tick` is 1200, `lastAgreedTick` is 600, and
    `divergence` describes that one comparison and no later one.
16. **A replay round-trips its rng.** `createRecorder` with an `RngSnapshot`, then a replay
    restoring that snapshot and driving the same inputs, produces identical digests at every
    checkpoint. *Fails when:* the log stored a seed but not the cursor — the failure this
    invariant exists to catch, because it looks correct for the first few draws.
17. **A condition is stable and early.** `store.status` is set before `open()` returns — assert
    it on the line after, with no tick in between. Then let a full-quota adapter reject twenty
    consecutive autosave writes and assert the status was the identical string on all twenty,
    and that one successful write returns it to `'ok'`. *Fails when:* a detail was interpolated
    into the status, which shows a latched notice every four seconds in the one situation the
    latch was written for.
18. **An input log survives storage unchanged.** Round-trip a `ReplayLog` through a replay store
    and assert the stored `inputs` is deep-equal to what went in, field order included where it
    is observable. And a replay written at format `N` read by a build at format `N + 1` returns
    `reason: 'orphaned'` — **not** a migrated log. *Fails when:* someone gives the replay store a
    chain with rungs in it, which is the single most likely way this package's doctrine gets
    quietly inverted.

---

## 7. The traps

Mined from `../foom-simple-ui`, which shipped this problem once already. `src/game/save.ts` is
82 lines and every one is a lesson; `PLAYBOOK.md` supplied the rest.

1. **`beforeunload` does not fire reliably on mobile Safari.** Bind `visibilitychange` (guarded
   on `visibilityState === 'hidden'`) and `pagehide`. A save that only runs on unload loses the
   session for the players whose sessions end by the phone going into a pocket.
2. **`localStorage.clear()` plus a reload does not reset the game.** PLAYBOOK trap 8, verbatim:
   the autosave flushes on `pagehide` and writes the live state back over the clear. The naive
   implementation of this package reproduces it exactly — a `clear()` helper next to a live
   autosave handle. The fix is ordering, and it is `reset()`: close first, stop the handles,
   *then* remove the key. A disposer that flushes (foom's did) is the same bug wearing a
   different hat, which is why `installFlushTriggers`' disposer does not write.
3. **Two live tabs share storage and the loser's flush wins.** PLAYBOOK trap 10 hit this while
   debugging something else entirely: a stray `localhost` tab silently undid a reset. Default
   behaviour is last-write-wins and is documented as such; `conflict: 'refuse'` exists for games
   where it matters. Do not silently "fix" it with a lock (§4.4).
4. **Private-mode Safari throws on the property access, not just on the write.** The guard must
   wrap the read of `globalThis.localStorage`. A try/catch around `setItem` alone still takes
   the page down.
5. **Strict version equality plus a fallback to `createGame` is not a migration policy; it is a
   delete.** foom's `save.ts` compared `parsed.version === SAVE_VERSION` and dropped everything
   else on the floor. Its own `state.ts` says so out loud: *"a bump is not a migration — it is a
   deletion of every player's campus."* That comment is the reason this package exists, and a
   builder who reimplements equality-and-fallback has rebuilt the thing being replaced.
6. **The optional-field escape hatch is a trap with a long fuse.** Because a bump meant deletion,
   foom stopped bumping: `aquifer`, `biome`, `favour`, `researchers`, `run`, `raids`, `diverted`,
   `raidLog`, `runReport`, `backlash` were all added as optional fields, each with a comment
   explaining that absent reads as some default. It works, and the bill arrives later: every one
   of those fields is `T | undefined` forever, every read site carries a `??`, and the
   "default" is now duplicated across a dozen call sites where it can drift. The chain exists so
   `aquifer` can be `number`. If a builder finds themselves recommending an optional field to
   avoid writing a rung, the API has failed.
7. **A save carries absolute epoch timestamps, and clocks move.** foom stored `readyAt` as an
   absolute instant, deliberately, so closing the tab does not pause a timer — correct, and it
   means a save is only meaningful against a clock that can jump. A player who changes their
   device date, crosses a DST boundary, or owns a device with a wrong clock produces a `savedAt`
   in the future. This package reports `savedAt` faithfully and does not clamp it; whoever
   computes offline accrual must, and that is a `sim` obligation routed in §8.
8. **JSON quietly destroys three things an idle game contains.** `undefined` fields vanish (fine),
   but `NaN` and `Infinity` serialise as `null`, and `BigInt` throws. An idle economy that lets a
   currency reach `Infinity` writes `null`, reads `null`, and becomes `NaN` on the next tick —
   with a valid checksum, because the bytes were never damaged. The head recogniser is the place
   to catch it: `expectFinite` from `core`'s `guard` on the currencies is worth more than a
   recogniser that checks thirty field names and no ranges.
9. **A checksum over a re-serialisation is not a checksum.** `JSON.stringify(JSON.parse(text))`
   reorders numeric-looking keys and normalises number formatting, so it fails on saves that are
   fine and passes on saves that are not. Checksum the bytes as read. This is why `d` is a
   string.
10. **Quota is discovered by throwing, inside the handler where nothing can be done.** Catch it,
    turn it into a `WriteFailure`, and check `maxBytes` before serialising so the common case is
    a skip rather than an exception at `pagehide`.
11. **Do not do work in the page-hide path beyond the write.** No analytics, no async, no second
    key. The page is being discarded; you get one synchronous write and the rest is fiction.
12. **"Reset everything" wipes the settings with the save.** The naive START OVER clears the
    origin or loops every key with the game's prefix, and the player's volume comes back at full
    in a quiet room. Reset the stores you mean, by name (§4.10). This is trap §7.2 wearing a
    tidier hat, and it is the reason there is no `resetEverything()`.
13. **Persist the hue, never the derived tokens.** Inherited from the source game and raised by
    the `core` architect as a joint `draw`/`persist` constraint neither RFC stated: a save that
    stores computed colours pins a player to the palette of the build that wrote it, so a
    retuned shadow or a fixed contrast bug never reaches anyone who already played. Store the
    input to the derivation — one hue — and derive on load, every time. It is also forty bytes
    instead of four hundred. The same rule generalises: **a save stores causes, not consequences**,
    which is why a replay stores inputs and digests rather than states.
14. **A `!` is a place where the compiler was told to stop helping.** PLAYBOOK trap 14: a single
    non-null assertion bricked two of four biomes on load. The parse path in this package is the
    highest-density source of `unknown` in the kit and will attract them. There are none in this
    surface and there should be none in the implementation.

---

## 8. Gaps this found that belong to other packages

Routed rather than fixed, per `docs/LOOP.md` rule 5. Four cross-package questions arrived during
this design and are answered in place: the timestamp seam (§4.8), replay ownership (§4.9), the
settings lifetime (§4.10), and the injected scheduler (§4.6). What follows is what is still open.

**Settled here, needing the other side to agree**

- **`loop` — the replay driver.** §4.9 takes the envelope, the checkpoint recorder and the
  verifier, and explicitly does not take the driver: constructing the game, restoring the rng
  snapshot, running the fixed step and pumping inputs in needs the loop and the tick index, and
  `persist` may not import a sibling. It should take a `ReplayVerifier` from here and a cursor
  from `input`. **Without it the recorder records sessions nobody replays** — the largest open
  item in this document. A `manualClock` driven flat out is most of it already.
- **`input` — the cursor over its own log, and the three compatibility fields.** Storing the log
  verbatim means storing it opaquely, so iteration belongs to whoever owns the shape (§4.9).
  `InputLog` also needs to expose `version`, `stepMs` and `profile` as `ReplayCompat` requires —
  three fields compared for equality and never interpreted, which is the whole of the coupling
  between these two packages. Ideally the current build's triple is read off a freshly created
  log rather than typed out at the call site, so the recorded and current values cannot drift.
- **`loop` — `real.after` must keep firing in a hidden tab.** §4.6 injects `Schedule` and the
  demo game will pass `loop.real.after`. If that is implemented on `requestAnimationFrame` it is
  0 Hz in a background tab and the autosave silently stops in the one situation that most often
  precedes a tab being closed. It needs to be interval-backed, and `loop` should be the single
  place in the kit that says so rather than five packages each warning about rAF.
- **`sim` — the upper clamp on the offline gap is yours.** §4.8 splits the clamps: `persist`
  clamps `elapsedSince` at zero from below because a backwards device clock is a correctness
  problem, and does not clamp from above because "how much of eight hours away pays out" is a
  balance decision. If `sim`'s RFC does not cap it, a phone whose clock jumps forward a year
  pays out a year, and that hole is `sim`'s.
- **`core` — `EpochMillis` and `Now`.** Already routed by the orchestrator. §3.5 is written
  against those names; if `core` brands `EpochMillis` rather than aliasing `number`, better
  still, because `elapsedSince(opened, tickCount)` would then stop compiling.
- **`draw` — persist the hue, never the derived tokens** (trap §7.13). A joint constraint that
  neither RFC stated; it belongs in `draw`'s colour section as well as here, because the package
  that derives the tokens is the one best placed to say they are not save data.

**Resolved by other RFCs since this was drafted, noted so nobody re-routes them**

- `core` provides `RngSnapshot` with the cursor included, which is what makes a replay honest
  and what invariant §6.16 tests. This was going to be this document's loudest gap.
- `core` split `hash` into its own module, so §3.1 uses `hashString` instead of growing a
  private FNV. One hash in the kit, not three.
- `core` renamed `assert` → `guard` with validators that return their argument; §3.3 adopts that
  shape for `Recognise<T>`, which is why a rejected save can name the field that was wrong.

**Still unowned**

- **`core` — a number representation that survives JSON and exceeds `Number.MAX_SAFE_INTEGER`.**
  Idle economies pass 2^53 routinely; JSON turns `Infinity` into `null` with a valid checksum
  (trap §7.8), and `format` will have to render those numbers anyway.
- ~~**`ui` — two notices with nowhere to live.**~~ **Resolved.** `ui` added `acknowledge()` and
  `ToastHost.once(key, text)`; this package answers with `store.status` (§4.11), a stable
  condition readable before the first tick. The wiring is three lines in the demo and belongs to
  neither package. `ui`'s observation that severity is a property of what the player loses, not
  of the message, is recorded in §4.11 because it is really about these failure modes.
- **`tools/lint` — a rung without a fixture should fail the build.** Invariant §6.4 is worth
  exactly what its fixtures are worth. Lint can read the chain head as a literal and check that
  a fixture exists for every version from floor to head. Two further rules worth adding while
  there: ban `!` non-null assertions (`PLAYBOOK.md` trap 14, and the parse path in this package
  will attract them), and ban `setTimeout`/`setInterval` in package `src/` now that scheduling is
  injected everywhere.
- **`.lattice/kit.json` — needs a routed edit I cannot make.** `packages.persist.modules` becomes
  `["store", "migrate", "adapters", "integrity", "replay", "browser"]`, `exports` should list the
  symbols in §3, and the `invariants` array should gain a fourth line: *"A replay verdict is
  never a false green — a log from another build is refused, not matched."* The existing three
  lines all still hold verbatim.
