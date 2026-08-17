/**
 * `@latticekit/persist` — saves that survive a version bump, a crashed tab and a browser that
 * lies about its storage.
 *
 * It does that by making the save an explicitly **versioned envelope**, the upgrade an
 * explicit **chain of one-step migrations**, and every failure a **reported value** instead of
 * a thrown exception on boot.
 *
 * Two consequences shape the whole surface:
 *
 * - **The storage adapter is injected.** `localStorage` is named in exactly one function in
 *   this package (`browserStorage`, in the one module marked `@browser-only`), and everything
 *   else — chain, envelope, checksum, coalescing, quarantine, replay — runs and tests in Node
 *   with no shims.
 * - **The read path never throws.** Boot is the one moment a game cannot recover from an
 *   exception, because there is no UI yet to show it in. All seven ways a save can be unusable
 *   are fields on a returned object.
 *
 * ```ts
 * const chain = migrations(1, isV1)
 *   .step(2, 'one coin counter became a wallet of currencies', v1 => ({ version: 2, wallet: { coin: v1.coins } }), isV2)
 *   .seal();
 * const store = createStore({ key: 'campus', chain, adapter: browserStorage(), fresh: newGame, now });
 * const opened = store.open();                       // never throws. `opened.failure` says why if it degraded
 * const auto = store.autosave(() => game.state, { schedule: scheduleFrom(loop.real) });
 * installFlushTriggers(auto, { visibility: document, page: window });
 * ```
 *
 * `scheduleFrom` and not `loop.real.after`: `loop` schedules in seconds and this package in
 * milliseconds, so passing the method directly is a compile error — and, cast away, an
 * autosave every 67 minutes that nothing reports. The conversion lives in one place.
 *
 * There is no `version` option, because the chain **is** the version; no `validate` option,
 * because validation is per-version inside the chain; no timer, because `schedule` is
 * injected; and no clock, because reading one would break non-negotiable #1 and defaulting one
 * would silently zero every offline gap.
 *
 * ## A note on the examples in this package
 *
 * **Anything in a doc comment that looks like a call is reachable from a test, and that is a
 * rule rather than an aspiration.** Two examples in this package were once wrong — one wired
 * `loop.real.after` straight into `schedule`, which is a compile error on the return type and
 * a 67-minute autosave interval once someone casts it away; the other composed a `core` guard
 * that cannot accept an `unknown`. Both survived a review, a full suite and 100% coverage,
 * because prose is not compiled and nothing was checking it.
 *
 * The lesson is narrower and more useful than "keep docs current": **a run-tested example and
 * a hand-written one are indistinguishable to a reader, and are read with equal trust.** A
 * reader copies the snippet that is nearest to the symbol they are looking at, not the one
 * that happens to be under test. So an example either compiles and runs somewhere, or it is
 * marked as a sketch — and the cheapest way to keep that honest is to paste the doc's example
 * into the test file verbatim and let `tsc` and `vitest` own it from then on.
 */

export { defaultChecksum } from './integrity.js';
export type { Checksum } from './integrity.js';

export { webStorage, memoryStorage } from './adapters.js';
export type { StorageLike, StorageAdapter } from './adapters.js';

export { migrations } from './migrate.js';
export type { Increment, Recognize, MigrationStep, MigrationChain, ChainBuilder } from './migrate.js';

export { createStore, inspect, elapsedSince, scheduleFrom } from './store.js';
export type {
  SecondsTimeline,
  Envelope,
  FailureReason,
  ReadFailure,
  OpenResult,
  WriteSkip,
  WriteFailure,
  WriteResult,
  Rejected,
  Cancel,
  Schedule,
  StoreStatus,
  StoreOptions,
  AutosaveOptions,
  Autosave,
  Store,
} from './store.js';

export { createRecorder, createVerifier } from './replay.js';
export type {
  ReplayCompat,
  Digest,
  Checkpoint,
  ReplayLog,
  RecorderOptions,
  Recorder,
  Refusal,
  Divergence,
  ReplayVerdict,
  ReplayVerifier,
} from './replay.js';

export { installFlushTriggers, browserStorage } from './browser.js';
export type { ListenerTarget, FlushTargets } from './browser.js';

/** The kit version this package was built as part of. */
export const VERSION = '0.1.0';
