/**
 * The envelope, the read pipeline, and the store.
 *
 * Two rules govern everything in this file and they are worth stating before the code:
 *
 * 1. **The read path never throws.** Boot is the one moment a game cannot recover from an
 *    exception, because there is no UI yet to show it in. Every read outcome — including all
 *    seven ways a save can be unusable — is a field on a returned object.
 * 2. **The write path never throws either**, for a different reason: the write that matters
 *    happens inside a `pagehide` handler on a page that is being discarded, where an
 *    exception is both unhandleable and invisible. A failed write is a `WriteResult`.
 *
 * Neither rule extends to *construction*. `createStore` and `seal()` throw loudly at
 * nonsense, because a developer error at startup is a different moment from a player's save
 * at boot and should be as loud as possible.
 */

import { asEpochMillis, isSerializable, type EpochMillis, type Now } from '@lattice/core';
import type { StorageAdapter } from './adapters.js';
import { defaultChecksum, type Checksum } from './integrity.js';
import type { MigrationChain } from './migrate.js';

/**
 * Four seconds between coalesced writes — the number the source game shipped.
 *
 * Below about one second you are paying a synchronous serialise plus a storage write on a
 * phone, once a second, forever; above about ten a crash costs a visible amount of progress.
 */
const DEFAULT_MIN_WRITE_INTERVAL_MS = 4000;

/** A save approaching this is a state-design problem that this package cannot fix. */
const DEFAULT_MAX_BYTES = 1_000_000;

/** 64 kB of evidence is enough to attach to a bug report and small enough to always fit. */
const DEFAULT_QUARANTINE_MAX_BYTES = 65_536;

/** The key the store manages itself, beside the caller's. Removed by `reset()`. */
const REJECTED_SUFFIX = ':rejected';

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
 *
 * Use `inspect()` rather than eyeballing it in devtools.
 */
export interface Envelope {
  /** Save format version — the head of the chain that wrote it. */
  readonly v: number;
  /**
   * When it was written, in epoch ms, read from the store's injected `now` — this package
   * has no clock of its own. The only timestamp in the format.
   */
  readonly t: EpochMillis;
  /** Write sequence, monotonic per key. Only used for cross-tab conflict detection. */
  readonly n: number;
  /** `checksum(d)`. */
  readonly c: string;
  /** The game's state, JSON-encoded. */
  readonly d: string;
}

/**
 * Every way a save can fail to become a state. Closed union; a reviewer can count the
 * branches, and every one of them degrades to a fresh state rather than throwing.
 */
export type FailureReason =
  /** Storage itself refused to be read. Private mode, a disabled setting, an I/O error. */
  | 'unreadable'
  /** Not JSON, or JSON that is not an envelope. Something else wrote to this key. */
  | 'malformed'
  /** Checksum mismatch, or the payload did not parse though the envelope did. Damaged bytes. */
  | 'corrupt'
  /**
   * `v` is above the chain head: the player has opened an older deploy. This one is not the
   * player's fault and must not cost them their save — it is the only reason that also sets
   * `writable: false`.
   */
  | 'future'
  /** `v` is below the chain floor: a save from before the versions this build still carries. */
  | 'orphaned'
  /**
   * A migration threw, or a step's recogniser rejected its own output. `atVersion` names the
   * rung and `message` carries what the recogniser said was wrong.
   */
  | 'migration-failed'
  /**
   * Migrated to the head and the head recogniser still threw. The chain has a bug, or
   * something else has been writing this key.
   */
  | 'invalid';

/**
 * The report. **This is what "reported" means: a value, not a log line and not a thrown
 * error.**
 *
 * The package never renders text at a player, never calls `console`, and never phones home.
 * It hands the game a record the game can log, count, put behind a debug panel, or show as
 * "we could not read your save" in its own voice — and that a test can assert on exactly.
 */
export interface ReadFailure {
  readonly reason: FailureReason;
  /**
   * Names the caller's mistake in prose, with the key and the versions in it — e.g.
   * `persist: save "campus" is version 9 but this build reads up to 7 — the player has an
   * older deploy. Storage was left untouched and this store will not write.`
   *
   * For a game's own logs and bug reports. **Do not show it to a player**: it is written in
   * one voice and one language, and a game that puts it on screen has a sentence in its UI it
   * cannot change without patching a dependency. Switch on `reason` and say it yourself.
   */
  readonly message: string;
  /** The version on disk, or `null` when the envelope was not readable at all. */
  readonly savedVersion: number | null;
  /** For `migration-failed`, the rung that threw. `null` otherwise. */
  readonly atVersion: number | null;
  /** The instant on disk, when the envelope carried a readable one. */
  readonly savedAt: number | null;
  /**
   * Whether the offending text was kept under `${key}:rejected`. `false` if quarantine is
   * off, if the quarantine write itself failed, if the text was never read, or for `future` —
   * which is never quarantined because nothing is being destroyed.
   */
  readonly quarantined: boolean;
  /** Whatever was thrown, unchanged. `unknown` because a migration can throw a string. */
  readonly cause: unknown;
}

/** What `open()` and `decode()` produce. Always playable, whatever happened. */
export interface OpenResult<T> {
  /** Always a playable state. `fresh()` was called if the save did not survive. */
  readonly state: T;
  readonly source: 'save' | 'fresh';
  /**
   * True only when storage held nothing. `source: 'fresh'` with `firstRun: false` is a save
   * that was **lost**, and a game that treats the two the same will report a healthy funnel
   * while quietly losing people.
   */
  readonly firstRun: boolean;
  /** The version read from disk, when it was below the head and migrated up. */
  readonly migratedFrom: number | null;
  /**
   * When the loaded save was written — non-null exactly when `source === 'save'`. What
   * offline accrual is measured from, and it can be in the *future* if the device clock
   * moved. Reported faithfully and never clamped; `elapsedSince` does the clamping.
   */
  readonly savedAt: number | null;
  /** False when this store refuses to write over what it found. Today that is `future` only. */
  readonly writable: boolean;
  /** From the adapter. False means this session will not be there tomorrow. */
  readonly durable: boolean;
  /** Non-null exactly when `source === 'fresh' && !firstRun`. */
  readonly failure: ReadFailure | null;
}

/**
 * Why a write did not happen. **Not errors** — every one of these is the store working
 * correctly, which is why they are a separate field from `error`.
 */
export type WriteSkip =
  /** The store was never opened, or has been closed or reset. */
  | 'closed'
  /** A save from the future is on disk and this build must not overwrite it. */
  | 'not-writable'
  /** The coalescing interval has not elapsed. The overwhelmingly common skip. */
  | 'too-soon'
  /** Another tab has written since we last did, and `conflict: 'refuse'` is set. */
  | 'conflict'
  /** The envelope exceeds `maxBytes`, so the quota was not discovered by throwing. */
  | 'too-large';

/** A write that was attempted and refused by the platform. */
export interface WriteFailure {
  readonly reason: 'quota' | 'unavailable';
  readonly message: string;
  readonly cause: unknown;
}

/** The outcome of one write attempt. `written`, `skipped` and `error` are mutually exclusive. */
export interface WriteResult {
  readonly written: boolean;
  /**
   * The envelope's length in UTF-16 code units — what a browser storage quota actually
   * counts, and what `maxBytes` is compared against. `0` when nothing was serialised.
   */
  readonly bytes: number;
  readonly skipped: WriteSkip | null;
  readonly error: WriteFailure | null;
}

/**
 * A save that could not be read, kept so a bug report can carry it.
 *
 * Degrading to fresh without keeping the bytes destroys the only copy of the bug that just
 * ate a player's campus, and the support conversation is then two people guessing.
 */
export interface Rejected {
  readonly failure: ReadFailure;
  /** The offending text, up to the quarantine cap. */
  readonly text: string;
  /** True when `text` is a prefix rather than the whole of what was on disk. */
  readonly truncated: boolean;
}

/** Undo a scheduled callback. Calling it twice is not an error. */
export type Cancel = () => void;

/**
 * Run `fn` after `afterMs` have passed, and hand back a way to cancel it.
 *
 * Injected, never created. `persist` may not import `@lattice/loop` — they are siblings on
 * layer 1 and the DAG forbids the edge — and it may not reach for a timer of its own, because
 * a package that creates a timer is a package that owns a leak. A browser game passes
 * `loop.real.after`; a Node test passes a function that records its callbacks and runs them
 * by hand, and every coalescing test then finishes in microseconds with no fake timers.
 *
 * **Whatever you pass must keep firing in a hidden tab.** `requestAnimationFrame` is 0 Hz
 * when the tab is backgrounded, so an rAF-backed scheduler stops saving at precisely the
 * moment a player is most likely to close the tab.
 */
export type Schedule = (afterMs: number, fn: () => void) => Cancel;

/**
 * What is wrong with this store right now, as a **condition rather than a message**.
 *
 * `@lattice/ui` latches player-facing notices on this value, so the contract is narrow:
 *
 * - **It is stable while the condition is.** A bare member of this union, always. It never
 *   carries a timestamp, an attempt count, a byte size or a version number. Interpolating a
 *   detail would defeat the latch in exactly the case the latch exists for — the autosave
 *   rediscovers full storage every four seconds, and a status that differs each time is shown
 *   each time. The details live on `Autosave.lastWrite`, `store.rejected()` and
 *   `OpenResult.failure`; the status is the key, not the payload.
 * - **It is readable the moment `open()` returns**, before a single tick. The newer-save case
 *   has to reach a player whose session has not started.
 * - **One value, most severe first.** `refusing-newer` masks `write-failing` masks
 *   `not-persistent`, and that is correct rather than a compromise: a store that is refusing
 *   to write has nothing to say about whether its writes would have survived.
 */
export type StoreStatus =
  /** Reading and writing normally. The overwhelmingly common value. */
  | 'ok'
  /**
   * A save exists that this build cannot read and must not overwrite. Nothing is being
   * written and nothing this session will survive.
   *
   * Set by `open()`, cleared only by `reset()` or by an `open()` that no longer finds a newer
   * save. **What the player loses by missing it: the entire session, silently.**
   */
  | 'refusing-newer'
  /**
   * Writes are being attempted and rejected — quota, or storage revoked mid-session. Set on a
   * failed write, cleared by the next successful one, so it is stable exactly as long as the
   * condition is.
   *
   * **What the player loses by missing it: everything since the last successful write**,
   * which grows for as long as they keep playing.
   */
  | 'write-failing'
  /**
   * The adapter is not durable — private mode, or storage refused at boot. The session plays
   * and will not be there tomorrow.
   *
   * **What the player loses by missing it: this session, once they close the tab.** Known at
   * construction, and it never changes for the life of the store.
   */
  | 'not-persistent';

/** Everything `createStore` needs. Four of these are required and none of them has a default. */
export interface StoreOptions<Head extends number, T> {
  /**
   * The storage key, and with it the lifetime. **One store, one key, and no store ever reads
   * or writes another store's key** — which is what makes progress, settings and replays
   * genuinely independent rather than independent by convention.
   *
   * The convention this kit recommends: `campus:save`, `campus:settings`,
   * `campus:replay:<id>`, plus `campus:save:rejected`, which the store manages itself. Save
   * slots are separate stores on separate keys; there is no slot concept and there does not
   * need to be one.
   *
   * If any part of the key is derived from something a player typed, hash it through
   * `hashString(name.normalize('NFC'))` — see `defaultChecksum`'s note. Without the
   * normalisation the same name typed on macOS and on Windows produces two different keys and
   * two different worlds.
   */
  readonly key: string;
  /** The chain. **Its head is the store's version**; there is no other version number. */
  readonly chain: MigrationChain<Head, T>;
  readonly adapter: StorageAdapter;
  /**
   * A brand-new game. Called on first run and on every degraded read. **Must not throw** — if
   * this throws, boot is over and there is nothing left to degrade to.
   */
  readonly fresh: () => T;
  /**
   * The game's calendar. **Required, with no default, deliberately.**
   *
   * `persist` stamps `savedAt` and cannot read a clock of its own: `Date.now` is banned inside
   * every package's `src/` and the linter enforces it. Defaulting this to `() => 0` would be
   * the worst bug this package could ship, because every save would load with an elapsed time
   * of zero, offline progress would silently pay out nothing, and *nothing would look
   * broken*. A missing argument is a compile error; a zeroed timestamp is a support ticket in
   * eight months.
   */
  readonly now: Now;
  /** Floor on the interval between coalesced writes. Default 4000. */
  readonly minWriteIntervalMs?: number;
  /**
   * What to do when another tab has written since we last did. Default `'last-write-wins'`,
   * which is free; `'refuse'` costs one extra adapter read per write and reports
   * `WriteSkip: 'conflict'` so the game can say "this game is open in another tab".
   *
   * This is detection, not a lock, and it is deliberately not one. Web Locks is not available
   * everywhere this kit runs and `BroadcastChannel` cannot tell you the holder was killed
   * rather than closed, so a half-lock leaks on a crashed tab and locks a player out of their
   * own game permanently. With no lock the loser merely overwrites; with a half-lock the
   * winner cannot play at all.
   */
  readonly conflict?: 'last-write-wins' | 'refuse';
  /** Default `defaultChecksum`, which is `core`'s `hashString` as eight hex digits. */
  readonly checksum?: Checksum;
  /** Keep unreadable saves under `${key}:rejected`. Default on, capped at 64 kB. */
  readonly quarantine?: false | { readonly maxBytes?: number };
  /**
   * Refuse to write an envelope larger than this rather than discover the quota by throwing.
   * Default 1,000,000.
   */
  readonly maxBytes?: number;
  /**
   * Called once, during `open()` or `decode()`, with the same record the result carries. For
   * a counter or a breadcrumb — the result is the source of truth, and a game that ignores
   * this loses nothing.
   */
  readonly onFailure?: (failure: ReadFailure) => void;
  /** Called on a failed write. Expect it more than once: a full quota does not heal. */
  readonly onWriteError?: (failure: WriteFailure) => void;
}

/** How an `Autosave` decides when to write. */
export interface AutosaveOptions {
  /**
   * The timer, injected. When supplied, the handle re-arms itself after every write and you
   * never call `tick`.
   *
   * Prefer this to polling: a `tick` driven by the simulation stops when the simulation stops,
   * and a paused or backgrounded game still owes the player the last four seconds of progress.
   */
  readonly schedule?: Schedule;
}

/**
 * A coalescing write handle bound to one getter. `store.autosave` makes it; `store.reset` and
 * `store.close` kill it.
 */
export interface Autosave {
  /**
   * The polling form, for a game with no scheduler. Writes iff `minWriteIntervalMs` has
   * passed since the last attempt, reading the instant from the store's injected `now`.
   *
   * **Returns a boolean, not a result object**: this is called for the life of the session and
   * an object per call is a garbage-collector pause with a pleasant signature. The detail of
   * the last write that actually happened is on `lastWrite`.
   *
   * Do not drive it from `requestAnimationFrame`: rAF is 0 Hz in a hidden tab, and a save that
   * stops when the tab is backgrounded is a save that never survives the tab being closed. A
   * no-op returning `false` when `schedule` was supplied, so wiring both is harmless rather
   * than a double write.
   */
  tick(): boolean;
  /** Write now if anything is owed, ignoring the interval. What the visibility handler calls. */
  flush(): WriteResult;
  /** The last write this handle attempted, or `null`. One object per real attempt, not per tick. */
  readonly lastWrite: WriteResult | null;
  /**
   * Detach and cancel any scheduled write. Idempotent. A stopped handle's `tick` and `flush`
   * are no-ops reporting `'closed'` — which is half of why `reset()` actually resets.
   */
  stop(): void;
}

/** One key's worth of saved state, versioned by its chain. */
export interface Store<T> {
  readonly key: string;
  /** The chain head. There is no other version number in the system. */
  readonly version: number;
  readonly phase: 'new' | 'open' | 'closed';
  /** False when a save from the future is on disk. Every write then skips `'not-writable'`. */
  readonly writable: boolean;
  /**
   * The current condition, safe to read on every frame and every update.
   *
   * A plain property returning a string literal: no allocation, no event subscription, no
   * disposer to leak. `ui` polls it, latches on it, and decides for itself what a given
   * condition is worth interrupting a player for — which is the correct division, because this
   * package cannot know what the player is in the middle of.
   */
  readonly status: StoreStatus;
  /**
   * Read storage and produce a state. **Never throws, for any content whatsoever.** Calling it
   * twice re-reads; calling it after `reset()` or `close()` reopens the store.
   */
  open(): OpenResult<T>;
  /**
   * `open()` minus the adapter: the entire read pipeline as a function of a string.
   *
   * This is the testing seam — a fixture file per historical version, run through `decode`, is
   * the regression test that the chain still reaches the head. It touches no storage, so it
   * quarantines nothing (`failure.quarantined` is always `false` here) and changes no store
   * state: the `writable` on its result is what `open()` *would* have set.
   */
  decode(text: string): OpenResult<T>;
  /**
   * The envelope text for `state`, exactly as `save` would write it. A backup or share-code
   * button is this plus the game's own encoding of choice.
   *
   * @throws TypeError if the state cannot be JSON-encoded — a `BigInt`, a cycle, or a bare
   *   `undefined`. This is the one write-path function that throws, because it is a developer
   *   tool rather than something a `pagehide` handler calls; `save()` catches the same failure
   *   and reports it as a `WriteResult`.
   */
  encode(state: T): string;
  /** Write now, unconditionally, subject only to `writable`, `phase`, `maxBytes` and conflict. */
  save(state: T): WriteResult;
  autosave(get: () => T, options?: AutosaveOptions): Autosave;
  /**
   * **A real reset.** In order: close the store to writes, stop every autosave handle it has
   * created, remove the key and the quarantine key, return a fresh state.
   *
   * The ordering is the whole point. `localStorage.clear()` followed by a reload does *not*
   * reset a game — the live autosave flushes on `pagehide` and writes the state back over the
   * clear. The game this kit came from lost real time to exactly that, and its fix was a
   * hand-rolled `window.foom.reset()`. Here it is the API: after `reset()` returns, no code
   * path in this package writes to the adapter until `open()` is called again.
   *
   * Scoped to **one store**. A game's START OVER calls it on the save store only; resetting
   * the settings store means "back to factory volume", which is a different button most games
   * do not have. There is no `resetEverything()` and the absence is deliberate.
   */
  reset(): T;
  /**
   * Tear down. Pass a getter to flush on the way out; pass nothing to close silently — which
   * is what a "delete my save" button wants and what `reset` does internally. Idempotent.
   */
  close(options?: { readonly flush?: false } | { readonly flush: true; readonly get: () => T }): void;
  /** The last save this store could not read, if quarantine kept it. Survives a reload. */
  rejected(): Rejected | null;
  clearRejected(): void;
}

/** Every reason, as a set, so a quarantined record read back from storage can be validated. */
const REASONS: ReadonlySet<string> = new Set<string>([
  'unreadable',
  'malformed',
  'corrupt',
  'future',
  'orphaned',
  'migration-failed',
  'invalid',
]);

/** A `ReadFailure` before the store knows whether the evidence was kept. */
interface FailureDraft {
  readonly reason: FailureReason;
  readonly message: string;
  readonly savedVersion: number | null;
  readonly atVersion: number | null;
  readonly savedAt: number | null;
  readonly cause: unknown;
}

/** Whatever was thrown, as prose. A migration may throw a string, a number, or nothing at all. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Narrow parsed JSON to something with string keys, without claiming anything about them. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

/** A field of a quarantined record, or `null` if a hand-edited file dropped it. */
function readNumber(record: Readonly<Record<string, unknown>>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && isSerializable(value) ? value : null;
}

/**
 * The envelope only, payload untouched, or `null` if this is not one.
 *
 * For tools, debug panels, and the `future` check — which must work without parsing a payload
 * written by a build that no longer exists. That is the whole reason `d` is a string.
 *
 * Never throws: `null` covers "not JSON", "JSON of another shape", and "an envelope whose
 * numbers are `NaN`". The numeric fields are checked with `core`'s `isSerializable` rather
 * than `expectSerializable` precisely because this runs on the boot path.
 */
export function inspect(text: string): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) return null;
  const v = record['v'];
  const t = record['t'];
  const n = record['n'];
  const c = record['c'];
  const d = record['d'];
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  if (typeof t !== 'number' || !isSerializable(t)) return null;
  if (typeof n !== 'number' || !isSerializable(n)) return null;
  if (typeof c !== 'string' || typeof d !== 'string') return null;
  return { v, t: asEpochMillis(t, 'envelope.t'), n, c, d };
}

/**
 * Milliseconds between the loaded save and now — the offline gap, and the one derived
 * quantity this package will compute for you.
 *
 * Returns `0` when there is nothing to measure (a first run, or a degraded read), which is the
 * correct elapsed time for a game that has just begun. **Clamped at zero from below**, because
 * a player who changes their device date produces a `savedAt` in the future and a negative
 * elapsed is not a thing a simulation should have to defend against.
 *
 * **Not clamped from above.** An offline cap is a balance decision — how much of eight hours
 * away a game chooses to pay out — and it belongs to `@lattice/sim`, not here. This function
 * reports the gap; `sim` decides what it is worth. Read `OpenResult.savedAt` directly if you
 * want to detect the backwards clock and say something about it.
 */
export function elapsedSince(opened: OpenResult<unknown>, now: EpochMillis): number {
  const savedAt = opened.savedAt;
  if (savedAt === null) return 0;
  const gap = now - savedAt;
  return gap > 0 ? gap : 0;
}

/**
 * A quota failure, distinguished from every other reason a write can be refused.
 *
 * Browsers disagree on how they say it — a `DOMException` named `QuotaExceededError`, Firefox's
 * `NS_ERROR_DOM_QUOTA_REACHED`, and legacy codes 22 and 1014 — so this asks three questions
 * and treats anything else as `'unavailable'`. Guessing wrong costs a label on a report, not
 * behaviour: both reasons set `status: 'write-failing'`.
 */
function isQuotaError(cause: unknown): boolean {
  const record = asRecord(cause);
  if (record === null) return false;
  const name = record['name'];
  if (typeof name === 'string' && name.toLowerCase().includes('quota')) return true;
  const code = record['code'];
  return code === 22 || code === 1014;
}

/**
 * Build a store for one key.
 *
 * **There is no `version` option.** The chain is the version: `createStore` reads `chain.head`,
 * so declaring 7 while shipping a chain that ends at 6 is not expressible. There is no
 * `validate` option either — validation is per-version, inside the chain, so there is one
 * concept rather than two.
 *
 * @throws TypeError if `key` is not a non-empty string, or `fresh`/`now` is not a function.
 * @throws RangeError if `minWriteIntervalMs` is negative or non-finite, or `maxBytes` is not a
 *   positive finite number. All of these are developer errors at construction, which is a
 *   different moment from a player's save at boot and is allowed to be loud.
 */
export function createStore<Head extends number, T>(options: StoreOptions<Head, T>): Store<T> {
  const { key, chain, adapter, fresh, now } = options;

  if (typeof key !== 'string' || key === '') {
    throw new TypeError(`createStore: expected a non-empty storage key, got ${String(key)}`);
  }
  if (typeof fresh !== 'function') {
    throw new TypeError(
      `createStore("${key}"): expected a \`fresh\` function returning a brand-new state, got ${String(fresh)} — it is what every degraded read degrades to`,
    );
  }
  if (typeof now !== 'function') {
    throw new TypeError(
      `createStore("${key}"): expected a \`now\` function returning epoch milliseconds, got ${String(now)} — this package may not read a clock, and defaulting one would zero every offline gap`,
    );
  }

  const minWriteIntervalMs = options.minWriteIntervalMs ?? DEFAULT_MIN_WRITE_INTERVAL_MS;
  if (!Number.isFinite(minWriteIntervalMs) || minWriteIntervalMs < 0) {
    throw new RangeError(
      `createStore("${key}"): expected minWriteIntervalMs to be a finite number >= 0, got ${String(minWriteIntervalMs)}`,
    );
  }
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new RangeError(
      `createStore("${key}"): expected maxBytes to be a finite number > 0, got ${String(maxBytes)}`,
    );
  }

  const checksum = options.checksum ?? defaultChecksum;
  const refuseOnConflict = options.conflict === 'refuse';
  const quarantineMaxBytes =
    options.quarantine === false ? null : (options.quarantine?.maxBytes ?? DEFAULT_QUARANTINE_MAX_BYTES);
  const onFailure = options.onFailure;
  const onWriteError = options.onWriteError;
  const rejectedKey = `${key}${REJECTED_SUFFIX}`;
  const durable = adapter.durable;

  let phase: 'new' | 'open' | 'closed' = 'new';
  let refusingNewer = false;
  let writeFailing = false;
  /** The highest write sequence this store has written or seen on disk. */
  let sequence = 0;
  const handles = new Set<Autosave>();

  // ── the read pipeline ──────────────────────────────────────────────────────

  type Analysis =
    | { readonly ok: true; readonly state: T; readonly envelope: Envelope }
    | { readonly ok: false; readonly draft: FailureDraft; readonly envelope: Envelope | null };

  function analyse(text: string): Analysis {
    const envelope = inspect(text);
    if (envelope === null) {
      return {
        ok: false,
        envelope: null,
        draft: {
          reason: 'malformed',
          message: `persist: save "${key}" is not a Lattice envelope — the text is not JSON, or not an object with v/t/n/c/d. Something else has written to this key.`,
          savedVersion: null,
          atVersion: null,
          savedAt: null,
          cause: null,
        },
      };
    }

    const head = chain.head;
    if (envelope.v > head) {
      return {
        ok: false,
        envelope,
        draft: {
          reason: 'future',
          message: `persist: save "${key}" is version ${String(envelope.v)} but this build reads up to ${String(head)} — the player has an older deploy. Storage was left untouched and this store will not write.`,
          savedVersion: envelope.v,
          atVersion: null,
          savedAt: envelope.t,
          cause: null,
        },
      };
    }
    if (envelope.v < chain.floor) {
      return {
        ok: false,
        envelope,
        draft: {
          reason: 'orphaned',
          message: `persist: save "${key}" is version ${String(envelope.v)} but this build reads from version ${String(chain.floor)} up — it is older than any format this build still carries.`,
          savedVersion: envelope.v,
          atVersion: null,
          savedAt: envelope.t,
          cause: null,
        },
      };
    }

    const actual = checksum(envelope.d);
    if (actual !== envelope.c) {
      return {
        ok: false,
        envelope,
        draft: {
          reason: 'corrupt',
          message: `persist: save "${key}" failed its checksum — the envelope claims ${envelope.c} and the payload hashes to ${actual}. The payload was not parsed.`,
          savedVersion: envelope.v,
          atVersion: null,
          savedAt: envelope.t,
          cause: null,
        },
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(envelope.d);
    } catch (cause) {
      return {
        ok: false,
        envelope,
        draft: {
          reason: 'corrupt',
          message: `persist: save "${key}" has an intact checksum over a payload that is not JSON: ${describe(cause)}. The checksum and the payload were written by different things.`,
          savedVersion: envelope.v,
          atVersion: null,
          savedAt: envelope.t,
          cause,
        },
      };
    }

    let entered = envelope.v;
    try {
      const state = chain.run(payload, envelope.v, (version: number): void => {
        entered = version;
      });
      return { ok: true, state, envelope };
    } catch (cause) {
      const atHead = entered === head;
      return {
        ok: false,
        envelope,
        draft: {
          reason: atHead ? 'invalid' : 'migration-failed',
          message: atHead
            ? `persist: save "${key}" reached version ${String(head)} and the head recogniser rejected it: ${describe(cause)}. The chain has a bug, or something else has been writing this key.`
            : `persist: save "${key}" stopped migrating at version ${String(entered)} on the way from ${String(envelope.v)} to ${String(head)}: ${describe(cause)}`,
          savedVersion: envelope.v,
          atVersion: atHead ? null : entered,
          savedAt: envelope.t,
          cause,
        },
      };
    }
  }

  /** Copy the offending text beside the key, capped, so a bug report can carry it. */
  function quarantine(text: string, draft: FailureDraft): boolean {
    if (quarantineMaxBytes === null || draft.reason === 'future') return false;
    const truncated = text.length > quarantineMaxBytes;
    const record = JSON.stringify({
      failure: {
        reason: draft.reason,
        message: draft.message,
        savedVersion: draft.savedVersion,
        atVersion: draft.atVersion,
        savedAt: draft.savedAt,
        cause: draft.cause === null ? null : describe(draft.cause),
      },
      text: truncated ? text.slice(0, quarantineMaxBytes) : text,
      truncated,
    });
    try {
      adapter.set(rejectedKey, record);
      return true;
    } catch {
      // Quarantine is evidence, not progress. Storage that will not take a copy of a broken
      // save must not turn a degraded boot into a failed one.
      return false;
    }
  }

  function degrade(draft: FailureDraft, quarantined: boolean): OpenResult<T> {
    const failure: ReadFailure = {
      reason: draft.reason,
      message: draft.message,
      savedVersion: draft.savedVersion,
      atVersion: draft.atVersion,
      savedAt: draft.savedAt,
      quarantined,
      cause: draft.cause,
    };
    onFailure?.(failure);
    return {
      state: fresh(),
      source: 'fresh',
      firstRun: false,
      migratedFrom: null,
      savedAt: null,
      writable: draft.reason !== 'future',
      durable,
      failure,
    };
  }

  function loaded(state: T, envelope: Envelope): OpenResult<T> {
    return {
      state,
      source: 'save',
      firstRun: false,
      migratedFrom: envelope.v < chain.head ? envelope.v : null,
      savedAt: envelope.t,
      writable: true,
      durable,
      failure: null,
    };
  }

  // ── the write pipeline ─────────────────────────────────────────────────────

  function envelopeText(state: T, n: number): string {
    const d = JSON.stringify(state);
    if (typeof d !== 'string') {
      throw new TypeError(
        `store("${key}").encode: the state does not survive JSON.stringify (it is \`undefined\` or a function), so there is nothing to write`,
      );
    }
    return JSON.stringify({ v: chain.head, t: now(), n, c: checksum(d), d });
  }

  function skip(reason: WriteSkip, bytes: number): WriteResult {
    return { written: false, bytes, skipped: reason, error: null };
  }

  /** Has another tab written past us since our last write? One extra read, opt-in. */
  function conflicted(): boolean {
    let text: string | null;
    try {
      text = adapter.get(key);
    } catch {
      // Storage we cannot read is not evidence of another tab. Let the write try and report.
      return false;
    }
    if (text === null) return false;
    const envelope = inspect(text);
    if (envelope === null) return false;
    return envelope.n > sequence;
  }

  function attemptWrite(state: T): WriteResult {
    if (phase !== 'open') return skip('closed', 0);
    if (refusingNewer) return skip('not-writable', 0);

    const n = sequence + 1;
    let text: string;
    try {
      text = envelopeText(state, n);
    } catch (cause) {
      const failure: WriteFailure = {
        reason: 'unavailable',
        message: `persist: save "${key}" could not be serialised: ${describe(cause)}`,
        cause,
      };
      writeFailing = true;
      onWriteError?.(failure);
      return { written: false, bytes: 0, skipped: null, error: failure };
    }

    const bytes = text.length;
    if (bytes > maxBytes) return skip('too-large', bytes);
    if (refuseOnConflict && conflicted()) return skip('conflict', bytes);

    try {
      adapter.set(key, text);
    } catch (cause) {
      const failure: WriteFailure = {
        reason: isQuotaError(cause) ? 'quota' : 'unavailable',
        message: `persist: save "${key}" was refused by storage at ${String(bytes)} code units: ${describe(cause)}`,
        cause,
      };
      writeFailing = true;
      onWriteError?.(failure);
      return { written: false, bytes, skipped: null, error: failure };
    }

    sequence = n;
    writeFailing = false;
    return { written: true, bytes, skipped: null, error: null };
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  function shutdown(): void {
    phase = 'closed';
    for (const handle of [...handles]) handle.stop();
  }

  function removeQuietly(target: string): void {
    try {
      adapter.remove(target);
    } catch {
      // A reset that cannot reach storage still has to close the store and stop the handles,
      // which is the half of it that actually prevents the live state being written back.
    }
  }

  function makeAutosave(get: () => T, autosaveOptions?: AutosaveOptions): Autosave {
    const schedule = autosaveOptions?.schedule;
    let stopped = false;
    let lastAttemptAt: number | null = null;
    let last: WriteResult | null = null;
    let cancel: Cancel | null = null;

    function perform(at: number): WriteResult {
      lastAttemptAt = at;
      const result = attemptWrite(get());
      last = result;
      return result;
    }

    function arm(): void {
      if (schedule === undefined) return;
      cancel = schedule(minWriteIntervalMs, (): void => {
        cancel = null;
        // A `Cancel` that does not cancel is a scheduler bug, and this handle must not write
        // after it has been stopped whatever its scheduler does.
        if (stopped) return;
        perform(now());
        arm();
      });
    }

    const handle: Autosave = {
      tick(): boolean {
        if (stopped || schedule !== undefined) return false;
        const at = now();
        if (lastAttemptAt !== null && at - lastAttemptAt < minWriteIntervalMs) return false;
        return perform(at).written;
      },
      flush(): WriteResult {
        if (stopped) {
          const result = skip('closed', 0);
          last = result;
          return result;
        }
        return perform(now());
      },
      get lastWrite(): WriteResult | null {
        return last;
      },
      stop(): void {
        if (stopped) return;
        stopped = true;
        if (cancel !== null) {
          const undo = cancel;
          cancel = null;
          undo();
        }
        handles.delete(handle);
      },
    };

    handles.add(handle);
    arm();
    return handle;
  }

  const store: Store<T> = {
    key,

    get version(): number {
      return chain.head;
    },

    get phase(): 'new' | 'open' | 'closed' {
      return phase;
    },

    get writable(): boolean {
      return !refusingNewer;
    },

    get status(): StoreStatus {
      if (refusingNewer) return 'refusing-newer';
      if (writeFailing) return 'write-failing';
      return durable ? 'ok' : 'not-persistent';
    },

    open(): OpenResult<T> {
      phase = 'open';
      refusingNewer = false;
      writeFailing = false;

      let text: string | null;
      try {
        text = adapter.get(key);
      } catch (cause) {
        return degrade(
          {
            reason: 'unreadable',
            message: `persist: storage refused to be read for save "${key}" — private mode, a disabled setting, or an I/O error: ${describe(cause)}`,
            savedVersion: null,
            atVersion: null,
            savedAt: null,
            cause,
          },
          false,
        );
      }

      if (text === null) {
        return {
          state: fresh(),
          source: 'fresh',
          firstRun: true,
          migratedFrom: null,
          savedAt: null,
          writable: true,
          durable,
          failure: null,
        };
      }

      const analysis = analyse(text);
      if (analysis.ok) {
        sequence = analysis.envelope.n;
        return loaded(analysis.state, analysis.envelope);
      }

      if (analysis.draft.reason === 'future') {
        refusingNewer = true;
      } else if (analysis.envelope !== null) {
        // Keep the sequence moving even across a broken save, so a second tab's write is
        // still detectable once this one starts writing again.
        sequence = analysis.envelope.n;
      }
      return degrade(analysis.draft, quarantine(text, analysis.draft));
    },

    decode(text: string): OpenResult<T> {
      const analysis = analyse(text);
      if (analysis.ok) return loaded(analysis.state, analysis.envelope);
      return degrade(analysis.draft, false);
    },

    encode(state: T): string {
      return envelopeText(state, sequence + 1);
    },

    save(state: T): WriteResult {
      return attemptWrite(state);
    },

    autosave(get: () => T, autosaveOptions?: AutosaveOptions): Autosave {
      return makeAutosave(get, autosaveOptions);
    },

    reset(): T {
      // The order is the entire point. Close first so every later write path reports
      // `'closed'`, stop the handles so no `pagehide` flush can resurrect the live state,
      // and only then remove the keys.
      shutdown();
      removeQuietly(key);
      removeQuietly(rejectedKey);
      refusingNewer = false;
      writeFailing = false;
      sequence = 0;
      return fresh();
    },

    close(closeOptions?: { readonly flush?: false } | { readonly flush: true; readonly get: () => T }): void {
      if (closeOptions !== undefined && closeOptions.flush === true) {
        attemptWrite(closeOptions.get());
      }
      shutdown();
    },

    rejected(): Rejected | null {
      let raw: string | null;
      try {
        raw = adapter.get(rejectedKey);
      } catch {
        return null;
      }
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      const record = asRecord(parsed);
      if (record === null) return null;
      const text = record['text'];
      const truncated = record['truncated'];
      const failureRecord = asRecord(record['failure']);
      if (typeof text !== 'string' || typeof truncated !== 'boolean' || failureRecord === null) return null;
      const reason = failureRecord['reason'];
      if (typeof reason !== 'string' || !REASONS.has(reason)) return null;
      const message = failureRecord['message'];
      return {
        failure: {
          reason: reason as FailureReason,
          message: typeof message === 'string' ? message : '',
          savedVersion: readNumber(failureRecord, 'savedVersion'),
          atVersion: readNumber(failureRecord, 'atVersion'),
          savedAt: readNumber(failureRecord, 'savedAt'),
          quarantined: true,
          cause: failureRecord['cause'] ?? null,
        },
        text,
        truncated,
      };
    },

    clearRejected(): void {
      removeQuietly(rejectedKey);
    },
  };

  return store;
}
