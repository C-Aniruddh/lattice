/**
 * `@lattice/persist` — saves that survive a version bump, a crashed tab and a browser that
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
 * const auto = store.autosave(() => game.state, { schedule: loop.real.after });
 * installFlushTriggers(auto, { visibility: document, page: window });
 * ```
 *
 * There is no `version` option, because the chain **is** the version; no `validate` option,
 * because validation is per-version inside the chain; no timer, because `schedule` is
 * injected; and no clock, because reading one would break non-negotiable #1 and defaulting one
 * would silently zero every offline gap.
 */

export { defaultChecksum } from './integrity.js';
export type { Checksum } from './integrity.js';

export { webStorage, memoryStorage } from './adapters.js';
export type { StorageLike, StorageAdapter } from './adapters.js';

export { migrations } from './migrate.js';
export type { Increment, Recognise, MigrationStep, MigrationChain, ChainBuilder } from './migrate.js';

export { createStore, inspect, elapsedSince } from './store.js';
export type {
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
