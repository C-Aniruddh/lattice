# RFC — `@lattice/persist`

> Status: proposed. Owner: architect. Implements to `.lattice/kit.json → packages.persist`.
> Nothing in this document is implemented yet. A builder should be able to write the package
> from it without asking a question.

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
const store = createStore({ key: 'campus', chain, adapter: browserStorage(), fresh: newGame });
const opened = store.open();                       // never throws. `opened.failure` says why if it degraded
const auto = store.autosave(() => game.state);     // coalesced writes; you drive the clock
installFlushTriggers(auto, { visibility: document, page: window, now: () => Date.now() });
```

`opened.state` is always a playable state. `game.tick` calls `auto.tick(nowMs)`; the store
writes at most once per four seconds and once more on the way out of the page.

Read what the example does *not* contain, because each absence is a decision:

| not in the example | because |
|---|---|
| a `version: 2` option | the chain **is** the version. `createStore` reads the head off the chain, so declaring 7 and shipping a chain that ends at 6 is not expressible. |
| a `validate` option | validation is per-version, inside the chain. There is one concept, not two. |
| `try` / `catch` | there is nothing to catch. `open()` returns a result. |
| `await` | the adapter is synchronous, deliberately. See §4.1. |
| a timer | this package owns no timer. The caller drives `tick`. See §4.6. |
| `localStorage` | `browserStorage()` reaches for it behind a guard and degrades to memory. It is the only place the word appears. |

---

## 3. The public surface

Five modules: `integrity`, `adapters`, `migrate`, `store`, `browser`. (`kit.json` currently
lists four — see §7, this needs a routed edit.) The block below type-checks as written under
the repo's `tsconfig.base.json` strictness, DOM lib present or absent.

### 3.1 Integrity

```ts
/**
 * A checksum over the exact payload text.
 *
 * **This detects accident, not malice, and pretending otherwise is worse than having none.**
 * It catches a truncated write, a string clipped by a quota limit, a sync extension that
 * half-wrote the key, and a payload someone hand-edited into invalid state — the class of
 * damage that otherwise loads as a subtly wrong world three sessions later. It does not and
 * cannot stop a determined player: the algorithm is in the bundle they downloaded, and
 * recomputing it in a devtools console takes under a minute. If your game's economy needs a
 * save the player cannot edit, your game needs a server, and this kit deliberately does not
 * have one.
 */
export type Checksum = (text: string) => string;

/** FNV-1a, 32 bits, as eight lowercase hex digits. Cheap, dependency-free, and enough for
 *  the corruption it is aimed at. Not a cryptographic hash and never described as one. */
export declare const fnv1a32: Checksum;
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
 * How a version recognises itself.
 *
 * A plain type predicate, because a schema language is a dependency and this kit has none.
 * Make it as loose as you can defend — checking that the two or three fields your migration
 * actually reads are present beats a field-by-field validator nobody maintains.
 */
export type Guard<T> = (value: unknown) => value is T;

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
  /** The head guard. `store.decode` runs this last, and a failure is `invalid`. */
  recognises(value: unknown): value is T;
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
   * recognised by its own guard before it was handed over. That is the whole reason a guard is
   * mandatory rather than optional: without it a migration reads `unknown` and every line in it
   * is a cast.
   */
  step<Next extends Increment<Head>, Migrated>(
    to: Next,
    why: string,
    migrate: (prior: Current) => Migrated,
    recognises: Guard<Migrated>,
  ): ChainBuilder<Next, Migrated>;
  /** Freeze. Re-checks the chain at runtime for callers who arrived from JavaScript, and
   *  throws `RangeError` naming the missing version. Developer error, thrown loudly, at
   *  construction — which is not the boot path a player's save travels. */
  seal(): MigrationChain<Head, Current>;
}

/**
 * Start a chain at the oldest version you still support, with the guard that recognises it.
 *
 * @param floor the oldest readable version. Raising it is a decision to abandon every save
 *              below it; make it in a commit of its own with the number in the message.
 */
export declare function migrations<Floor extends number, T>(
  floor: Floor,
  recognises: Guard<T>,
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
export interface SaveEnvelope {
  /** Save format version. */
  readonly v: number;
  /** When it was written, in epoch ms, supplied by the caller — this package has no clock. */
  readonly t: number;
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
  /** A migration threw, or a step's guard rejected its own output. `atVersion` names the rung. */
  | 'migration-failed'
  /** Migrated to the head and the head guard still said no. The chain has a bug, or something
   *  else has been writing this key. */
  | 'invalid';

/**
 * The report. **This is what "reported" means: a value, not a log line and not a thrown error.**
 *
 * The package never renders text at a player, never calls `console`, and never phones home.
 * It hands the game a record the game can log, count, put behind a debug panel, or show as
 * "we could not read your save" in its own voice — and that a test can assert on exactly.
 */
export interface SaveFailure {
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
  readonly failure: SaveFailure | null;
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
export interface RejectedSave {
  readonly failure: SaveFailure;
  readonly text: string;
  readonly truncated: boolean;
}

export interface StoreOptions<Head extends number, T> {
  /** The storage key. Save slots are separate stores on separate keys; there is no slot concept. */
  readonly key: string;
  readonly chain: MigrationChain<Head, T>;
  readonly adapter: StorageAdapter;
  /** A brand-new game. Called on first run and on every degraded read. Must not throw — if this
   *  throws, boot is over and there is nothing left to degrade to. */
  readonly fresh: () => T;
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
  /** Default `fnv1a32`. */
  readonly checksum?: Checksum;
  /** Keep unreadable saves under `${key}:rejected`. Default on, capped at 64 kB. §4.5. */
  readonly quarantine?: false | { readonly maxBytes?: number };
  /** Refuse to write an envelope larger than this rather than discover the quota by throwing.
   *  Default 1_000_000. A save near this is a design problem this package cannot fix. */
  readonly maxBytes?: number;
  /** Called once, during `open`/`decode`, with the same record the result carries. For a
   *  counter or a breadcrumb — the result is the source of truth. */
  readonly onFailure?: (failure: SaveFailure) => void;
  /** Called on a failed write. Expect it more than once: quota does not heal. */
  readonly onWriteError?: (failure: WriteFailure) => void;
}

/**
 * A coalescing write handle bound to one getter. `store.autosave` makes it; `store.reset` and
 * `store.close` kill it.
 */
export interface Autosave {
  /**
   * Drive this from whatever advances your simulation. Writes iff `minWriteIntervalMs` has
   * passed since the last write.
   *
   * **Returns a boolean, not a result object** (house rule 7): this is called on the interval
   * for the life of the session, and an object per call is a GC pause with a pleasant
   * signature. The detail of the last write that actually happened is on `lastWrite`.
   *
   * Do not drive it from `requestAnimationFrame`: rAF is 0 Hz in a hidden tab, and a save that
   * stops when the tab is backgrounded is a save that never survives the tab being closed.
   */
  tick(nowMs: number): boolean;
  /** Write now if anything is owed, ignoring the interval. What the visibility handler calls. */
  flush(nowMs: number): WriteResult;
  /** The last write this handle attempted, or `null`. One object per real write, not per tick. */
  readonly lastWrite: WriteResult | null;
  /** Detach. Idempotent. A stopped handle's `tick` and `flush` are no-ops reporting `'closed'`. */
  stop(): void;
}

export interface SaveStore<T> {
  readonly key: string;
  /** The chain head. There is no other version number in the system. */
  readonly version: number;
  readonly phase: 'new' | 'open' | 'closed';
  readonly writable: boolean;
  /** Read storage and produce a state. Never throws, for any content whatsoever. Calling it
   *  twice re-reads; calling it after `reset()` reopens the store. */
  open(): OpenResult<T>;
  /**
   * `open()` minus the adapter: the entire read pipeline as a function of a string.
   *
   * This is the testing seam. A fixture file per historical version, run through `decode`, is
   * the regression test that the chain still reaches the head (§4.3, §5.4).
   */
  decode(text: string): OpenResult<T>;
  /** The envelope text for `state`, exactly as `save` would write it. A backup or share-code
   *  button is this plus the game's own encoding of choice. */
  encode(nowMs: number, state: T): string;
  /** Write now, unconditionally, subject only to `writable` and `phase`. */
  save(nowMs: number, state: T): WriteResult;
  autosave(get: () => T): Autosave;
  /**
   * **A real reset.** In order: close the store to writes, stop every autosave handle it has
   * created, remove the key and the quarantine key, return a fresh state.
   *
   * The ordering is the whole point. `localStorage.clear()` followed by a reload does *not*
   * reset a game — the live autosave flushes on `pagehide` and writes the state back over the
   * clear. The source game lost real time to this (§6.2) and its fix was a hand-rolled
   * `window.foom.reset()`. Here it is the API: after `reset()` returns, no code path in this
   * package writes to the adapter until `open()` is called again. That is invariant §5.2, and
   * it is testable without a browser.
   */
  reset(): T;
  /** Tear down. Pass a getter to flush on the way out; pass nothing to close silently — which
   *  is what a "delete my save" button wants and what `reset` does internally. */
  close(options?: { readonly flush?: false } | { readonly flush: true; readonly nowMs: number; readonly get: () => T }): void;
  /** The last save this store could not read, if quarantine kept it. For a debug panel or a
   *  bug-report payload. */
  rejected(): RejectedSave | null;
  clearRejected(): void;
}

/** Throws `RangeError`/`TypeError` on nonsense options — a developer error at construction,
 *  which is a different moment from a player's save at boot and is allowed to be loud. */
export declare function createStore<Head extends number, T>(options: StoreOptions<Head, T>): SaveStore<T>;

/** The envelope only, payload untouched, or `null` if this is not one. For tools, debug panels,
 *  and the `future` check that must work without parsing a payload it cannot understand. */
export declare function inspect(text: string): SaveEnvelope | null;
```

### 3.6 Browser wiring

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
  /** The host clock. This package has none; `Date.now` is banned inside `src/`. */
  readonly now: () => number;
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
 * is the mechanism behind the reset trap in §6.2.
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
| test | a fixture per historical version through `store.decode`, asserting `outcome`, `migratedFrom`, and the head guard | `decode(fixtures['v3'])` returns `failure.reason: 'migration-failed'` at a named rung |

The first two make a hole unwritable. Only the third catches a rung that exists and is *wrong*,
which is the failure that actually ships, so it is not optional: **the kit's own demo game keeps
one fixture per version from the floor up, and adding a rung without adding a fixture should
fail lint.** That last clause is a change to `tools/lint` and is routed in §7.

Design notes on the chain itself:

- **`to === from + 1`, always. No 3→7 shortcut.** A shortcut means two paths from 3 to 7 and
  only one of them is ever exercised; the untested one is the path a player's four-year-old
  save takes.
- **Every version has a guard, mandatory, including the floor.** This is how `migrate` receives
  a typed argument instead of `unknown`. A chain of migrations that each begin with a cast is
  not a chain, it is a stack of hopes.
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

### 4.6 The store owns no timer

`tick(nowMs)` is driven by the caller, and time arrives as a parameter — the kit's first
non-negotiable. This makes every coalescing test a loop over numbers with no fake timers, keeps
`setTimeout` out of `src/`, and lets the store compose with `@lattice/loop`'s scheduler instead
of racing it.

It also puts one obligation on the game, which the doc comment on `tick` states: **drive it
from the interval that drives your simulation, not from `requestAnimationFrame`.** rAF is 0 Hz
in a hidden tab, so an rAF-driven autosave stops saving at precisely the moment the player is
most likely to close the tab.

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

The consequence a builder must not soften: `Guard<T>` has no optional variant, no default
`() => true`, and no "skip validation in production" flag.

---

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
5. **A schema language or validator.** §4.7. Guards are functions. Zod is a dependency, and the
   second non-negotiable says there are none.
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
9. **Undo, rewind, and snapshot history.** That is a replay concern, and in a deterministic kit a
   replay is a seed plus an input log, not a ring buffer of saves. It belongs near `loop`, not
   here — routed in §7.
10. **Timers.** §4.6. The caller drives `tick`.
11. **Automatic or inferred migration** — "spread the new defaults over the old object". Every
    rung is a named function with a `why` a reviewer can read. See §6.6 for what the alternative
    actually costs.
12. **Version skipping.** No 3→7 rung. §4.3.

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
   `get(key)` is `null`. *Fails when:* the trap in §6.2 has been reintroduced.
3. **Round trip.** For any JSON-round-trippable `T`, `store.decode(store.encode(t, s))` yields
   `source: 'save'`, `migratedFrom: null`, `savedAt: t`, and a state deep-equal to `s`.
4. **The floor still reaches the head.** For every fixture from `chain.floor` to `head - 1`,
   `decode` returns `source: 'save'`, `migratedFrom` equal to the fixture's version, and a state
   the head guard accepts. *Fails when:* a rung was added or edited without its fixture.
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
10. **The package is isomorphic.** `src/` contains no reference to `localStorage`, `document`,
    `window`, `Date.now`, `performance.now`, `setTimeout` or `setInterval` — except
    `browserStorage`, which reaches for `localStorage` behind a guard, and that is one grep-able
    exception. The suite imports nothing browser-shaped and passes under plain `node`.

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
   with a valid checksum, because the bytes were never damaged. The head guard is the place to
   catch it; a guard that checks `Number.isFinite` on the currencies is worth more than one that
   checks thirty field names.
9. **A checksum over a re-serialisation is not a checksum.** `JSON.stringify(JSON.parse(text))`
   reorders numeric-looking keys and normalises number formatting, so it fails on saves that are
   fine and passes on saves that are not. Checksum the bytes as read. This is why `d` is a
   string.
10. **Quota is discovered by throwing, inside the handler where nothing can be done.** Catch it,
    turn it into a `WriteFailure`, and check `maxBytes` before serialising so the common case is
    a skip rather than an exception at `pagehide`.
11. **Do not do work in the page-hide path beyond the write.** No analytics, no async, no second
    key. The page is being discarded; you get one synchronous write and the rest is fiction.
12. **A `!` is a place where the compiler was told to stop helping.** PLAYBOOK trap 14: a single
    non-null assertion bricked two of four biomes on load. The parse path in this package is the
    highest-density source of `unknown` in the kit and will attract them. There are none in this
    surface and there should be none in the implementation.

---

## 8. Gaps this found that belong to other packages

Routed rather than fixed, per `docs/LOOP.md` rule 5.

- **`core` — the RNG state must be serialisable, or determinism dies at the first reload.** A
  save carrying only the seed re-rolls every draw the session already spent, so a reloaded game
  diverges from the one the player left. `Rng` needs a `state` that round-trips through JSON
  (`snapshot(): number` or a small tuple, and `restore`). This is a cross-package invariant with
  no owner right now, and it is the most important item on this list.
- **`core` — `fnv1a32` probably belongs in `core/hash`, not here.** `draw` will want a stable hash
  for sprite cache keys and `iso` for chunk identity. If `core` takes it, this package imports it
  and drops one export; until then it lives in `integrity`.
- **`core` — a number representation that survives JSON and exceeds `Number.MAX_SAFE_INTEGER`.**
  Idle economies pass 2^53 routinely, and `format` will have to render those numbers anyway. See
  trap §7.8.
- **`loop` — an interval-driven ticker.** `Autosave.tick` must keep being called in a hidden tab,
  which means `setInterval`, not rAF. `loop` should own the one place in the kit that says so,
  and the demo game should use it rather than each package warning about it separately.
- **`sim` — offline accrual must handle a `savedAt` in the future and clamp a large gap.** This
  package reports the timestamp; something has to decide that a save from "tomorrow" accrues
  zero rather than negative, and that a save from last year does not pay out a year at once.
  Same clamp `loop` already promises for catch-up ticks.
- **`ui` — two first-run notices with nowhere to live.** "Your browser will not keep this save"
  (`durable: false`, shown once) and "this save was made by a newer version of the game"
  (`writable: false`, which needs a blocking dialog, not a toast). Both are the correct response
  to a field on `OpenResult` and neither has a primitive today.
- **`tools/lint` — a rung without a fixture should fail the build.** Invariant §6.4 is only worth
  what its fixtures are worth. Lint knows the chain head is a literal in the demo game's source;
  it can check that a fixture file exists for every version from floor to head.
- **`.lattice/kit.json` — needs a routed edit.** `packages.persist.modules` should become
  `["store", "migrate", "adapters", "integrity", "browser"]`, and `exports` should list the
  symbols in §3. I own only this file and cannot make that change.
- **Replay is unowned.** Deliberately absent item 9 says snapshots belong to a seed plus an input
  log. Nothing in `kit.json` owns that, and a deterministic kit that cannot replay a session has
  left its headline claim untested. Worth a package or a `loop` module before v1.
