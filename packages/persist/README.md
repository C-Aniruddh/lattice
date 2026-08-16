# @lattice/persist

> Saves that survive: versioned state, an explicit migration chain, pluggable storage, debounced writes and integrity checks.

Part of **[Lattice](https://github.com/C-Aniruddh/lattice)** — the grid underneath.

```bash
npm i @lattice/persist
```

`@lattice/persist` keeps a player's game across a version bump, a crashed tab and a browser
that lies about its storage — by making the save an explicitly **versioned envelope**, the
upgrade an explicit **chain of one-step migrations**, and every failure a **reported value**
instead of a thrown exception on boot.

---

## The example

This runs in Node with no shims. It is a real script, and the output below it is what it
actually printed.

```ts
import { asEpochMillis } from '@lattice/core';
import {
  createStore,
  defaultChecksum,
  elapsedSince,
  memoryStorage,
  migrations,
  type Recognize,
} from '@lattice/persist';

interface V1 { readonly version: 1; readonly coins: number }
interface V2 { readonly version: 2; readonly wallet: { readonly coin: number } }

// A recognizer returns the value typed, or throws naming the field. Never a boolean.
const isV1: Recognize<V1> = (value) => {
  const coins = (value as { coins?: unknown }).coins;
  if (typeof coins !== 'number' || !Number.isFinite(coins)) {
    throw new RangeError(`save.v1.coins: expected a finite number, got ${String(coins)}`);
  }
  return { version: 1, coins };
};

const isV2: Recognize<V2> = (value) => {
  const coin = (value as { wallet?: { coin?: unknown } }).wallet?.coin;
  if (typeof coin !== 'number' || !Number.isFinite(coin)) {
    throw new RangeError(`save.v2.wallet.coin: expected a finite number, got ${String(coin)}`);
  }
  return { version: 2, wallet: { coin } };
};

// The chain IS the version. There is no `version: 2` option to disagree with it.
const chain = migrations(1, isV1)
  .step(
    2,
    'one coin counter became a wallet of currencies',
    (v1) => ({ version: 2 as const, wallet: { coin: v1.coins } }),
    isV2,
  )
  .seal();

let clock = 1_700_000_000_000;   // the game owns the calendar; this package never reads one
const adapter = memoryStorage(); // `browserStorage()` in a browser
const store = createStore({
  key: 'campus:save',
  chain,
  adapter,
  fresh: (): V2 => ({ version: 2, wallet: { coin: 0 } }),
  now: () => asEpochMillis(clock),
});

// A save left by the previous build, ninety seconds ago, still at version 1.
const payload = '{"coins":250}';
adapter.set(
  'campus:save',
  JSON.stringify({ v: 1, t: clock - 90_000, n: 1, c: defaultChecksum(payload), d: payload }),
);

const opened = store.open();     // never throws, for any content whatsoever
console.log(opened.source, opened.migratedFrom, JSON.stringify(opened.state));
console.log(store.status, store.version, elapsedSince(opened, asEpochMillis(clock)));

// Coalesced writes. No timer here: `tick()` polls, or pass `scheduleFrom(loop.real)`.
let live: V2 = opened.state;
const auto = store.autosave(() => live);
live = { version: 2, wallet: { coin: 300 } };
console.log(auto.tick(), auto.tick());
clock += 4001;
console.log(auto.tick(), auto.lastWrite?.bytes);

// A corrupt save degrades to a fresh one with a reason, and keeps the evidence.
adapter.set('campus:save', '{"v":2,"t":0,"n":9,"c":"00000000","d":"{}"}');
const broken = store.open();
console.log(broken.source, broken.firstRun, broken.failure?.reason);
console.log(store.rejected()?.failure.message);

// START OVER: close, stop the handles, then remove the key — in that order.
live = store.reset();
console.log(auto.flush().skipped, adapter.get('campus:save'));
```

```
save 1 {"version":2,"wallet":{"coin":250}}
not-persistent 2 90000
true false
true 94
fresh false corrupt
persist: save "campus:save" failed its checksum — the envelope claims 00000000 and the payload hashes to 446b98f4. The payload was not parsed.
closed null
```

Four things in that output are worth reading twice:

- `save 1` — the v1 save was **migrated**, not deleted. `migratedFrom` says where it came from.
- `not-persistent` — `memoryStorage()` is not durable, and the store says so before a single
  tick. Swap in `browserStorage()` and it reads `ok`.
- `true false` / `true 94` — the first tick writes, the second is inside the four-second
  window and does not, and the third writes once the clock has moved past it.
- `closed null` — after `reset()` the live autosave handle is dead, so the `pagehide` flush
  that comes next writes nothing. That ordering is the whole point of `reset()`.

In a browser the last three lines of wiring are:

```ts
const store = createStore({ key: 'campus:save', chain, adapter: browserStorage(), fresh, now });
const auto = store.autosave(() => game.state, { schedule: scheduleFrom(loop.real) });
installFlushTriggers(auto, { visibility: document, page: window });
```

`scheduleFrom(loop.real)`, **never** `loop.real.after`. `@lattice/loop` schedules in seconds
and returns a `TimerId`; this package schedules in milliseconds and wants a `Cancel`. Passing
the method directly does not compile — and cast through, it asks for a write every 4,000
*seconds*, so the game autosaves once every 67 minutes while `store.status` reports `ok` the
whole time. `scheduleFrom` is the only `/ 1000` in the package and it exists so that
conversion happens once, here, instead of in a three-line shim in every game.

---

## Why it is shaped like this

### The chain is the version

`createStore` reads the current version off `chain.head`. Declaring version 7 while shipping a
chain that ends at 6 is not a bug you can write down. A hole in the chain is caught three ways:

| when | mechanism | what a hole looks like |
|---|---|---|
| compile | `step`'s `to` is typed `Increment<Head>` | `Argument of type '3' is not assignable to parameter of type '2'` |
| construction | `seal()` re-walks the rungs for callers arriving from JavaScript | `RangeError: persist: migration chain jumps 1 → 3; version 2 has no migration` |
| test | a fixture per historical version through `store.decode` | `decode(fixtures.v3)` returns `failure.reason: 'migration-failed'` at a named rung |

Only the third catches a rung that exists and is *wrong*, which is the failure that actually
ships. Keep one fixture per version from the floor up.

The alternative — `parsed.version === SAVE_VERSION` with a fallback to `newGame()` — is not a
migration policy. It is a delete, and the game this kit was extracted from said so in its own
source: *"a bump is not a migration — it is a deletion of every player's campus."*

### Every failure is a value

`open()` never throws, for any content whatsoever. There are seven ways a save fails to become
a state, and every one of them degrades to `fresh()` with a report:

| reason | what happened | writable after? |
|---|---|---|
| `unreadable` | storage itself refused to be read | yes |
| `malformed` | not JSON, or not an envelope — something else wrote to this key | yes |
| `corrupt` | checksum mismatch, or a payload that did not parse | yes |
| `future` | the save is newer than this build | **no** |
| `orphaned` | the save is older than the chain floor | yes |
| `migration-failed` | a rung threw, or a step's recognizer rejected its own output | yes |
| `invalid` | reached the head and the head recognizer still refused | yes |

`firstRun` is a separate field from `source` for one reason: `source: 'fresh'` with
`firstRun: false` is **a save that was lost**, and a game that cannot tell the two apart will
report a healthy funnel while quietly losing people.

The unreadable text is copied to `${key}:rejected` (capped at 64 kB, with a `truncated` flag)
and read back through `store.rejected()`. Degrading to fresh without keeping the bytes destroys
the only copy of the bug that just ate a player's campus.

### A save from the future makes the store read-only

The player opened a stale deploy — a cached `index.html`, a service worker, a second device on
an old build. Their v9 save is fine; the v7 build cannot read it. Degrading to fresh is correct
*in memory* and catastrophic *on disk*, because the old build would autosave four seconds later
and overwrite a good save with an empty campus.

So `future` is the one reason that also sets `writable: false`. Every write then skips with
`'not-writable'` and storage comes out of the session byte-identical. The game's job is to say
something — and if the player insists on starting over anyway, `reset()` is the one-line escape
hatch. Nothing else gets past a non-writable store.

### `status` is a condition, not a message

`store.status` is one of four bare string literals, most severe first:

| status | what the player loses by missing it | fits |
|---|---|---|
| `refusing-newer` | the whole session, silently, and they cannot tell | a modal they must acknowledge |
| `write-failing` | everything since the last good write, growing | a modal if it persists |
| `not-persistent` | this session, once they close the tab | a toast, latched once |
| `ok` | nothing | nothing |

It never carries a timestamp, an attempt count, a byte size or a version number. Interpolating
a detail would defeat a latch in exactly the case the latch exists for: the autosave
rediscovers a full quota every four seconds, and a status that differs each time is shown each
time. The details live on `Autosave.lastWrite`, `store.rejected()` and `OpenResult.failure`.

It is also readable **the moment `open()` returns**, before a single tick, because the
newer-save case has to reach a player whose session has not started.

### `reset()` closes before it removes

```
close the store to writes  →  stop every autosave handle  →  remove the key and its quarantine
```

`localStorage.clear()` followed by a reload does *not* reset a game: the live autosave flushes
on `pagehide` and writes the state back over the clear. The fix is the ordering, and it is
testable in Node — after `reset()` returns, no code path in this package writes to the adapter
until `open()` is called again. The disposer returned by `installFlushTriggers` deliberately
does **not** flush, because a disposer that writes is the same bug wearing a different hat.

`reset()` is scoped to **one store**. There is no `resetEverything()`: it would be four lines
and it would put the player's volume back at full at one in the morning.

### This package owns no clock and no timer

Both are injected and neither has a default.

- **`now: Now`** is a required field of `StoreOptions`. `Date.now` is banned inside every
  package's `src/` and the linter enforces it. Defaulting this to `() => 0` would be the worst
  bug in this package's reach: every save would load with an elapsed of zero, offline progress
  would pay out nothing, and *nothing would look broken*.
- **`schedule: Schedule`** is optional on `autosave`, and when it is absent you drive `tick()`
  yourself. `persist` may not import `@lattice/loop` — siblings on layer 1, and the DAG forbids
  the edge — so a browser game passes `scheduleFrom(loop.real)` and a Node test passes a
  function that records its callbacks and runs them by hand. `Schedule` counts in
  **milliseconds**, like `minWriteIntervalMs` and every other duration here; `SecondsTimeline`
  is the seconds-shaped thing `scheduleFrom` adapts, declared structurally so no edge is
  needed.

Whatever you pass as `schedule` **must keep firing in a hidden tab**. `requestAnimationFrame`
is 0 Hz when the tab is backgrounded, which is precisely the moment before a tab is closed.

### A replay is evidence, and evidence is never migrated

| | **save** | **replay** |
|---|---|---|
| old format | migrated, rung by rung | **refused** — `orphaned` |
| mechanism | a chain with rungs from floor to head | a chain with **no rungs**: `migrations(N, isLog).seal()` |
| near-miss | tolerated; a recognizer may normalize as it validates | **refused**, by name |
| failure costs | a player's campus | a test result nobody should have trusted |

A save is progress; a replay is evidence, and evidence that has been migrated is no longer
evidence. A session recorded at a 16.667 ms step and replayed at 20 ms produces a **confident
wrong answer**, which is worse than a refusal. So a replay store is an ordinary `createStore`
whose chain has floor equal to head — no second code path, and an old replay reads as
`orphaned` through machinery that already exists.

`createVerifier` checks five values for exact equality before the first tick — `kit`, `game`,
`inputs.version`, `inputs.stepMs`, `inputs.profile` — and a `Refusal` names the one that
differed. `matched` is never `true` for a refused or partially driven replay.

```ts
const recorder = createRecorder({ kit: VERSION, game: 'campus@3', rng: rng.snapshot(), startTick: 0, digest });
// …every tick: recorder.mark(tick, state)
const log = recorder.stop(tick, state, inputLog);

const verifier = createVerifier(log, { kit: VERSION, game: 'campus@3', inputs: freshLog, digest });
// …every tick: if (!verifier.mark(tick, state)) break;
const verdict = verifier.finish();
// verdict.divergence: { tick: 1200, lastAgreedTick: 600, … } — the bug is between those two
```

---

## The one trap that will find you

**`hashString` walks UTF-16 code units.** Two consequences pull in opposite directions, and
which one applies depends on whether you are hashing *text a human means* or *bytes a machine
wrote*:

```ts
// A key derived from something a player typed. Normalize first, ALWAYS.
// macOS hands you NFD; Windows and most browsers hand you NFC. Without this, the same
// visible name typed on two machines produces two save keys and two different worlds —
// and the bug reproduces on nobody's machine.
const key = `campus:save:${hashString(playerName.normalize('NFC')).toString(16)}`;

// A checksum over a payload. NEVER normalize — the bytes are the subject, and a save
// truncated mid-combining-sequence must fail.
const c = defaultChecksum(payloadText);
```

Ask which of the two you have before you reach for `normalize`.

A few more, mined from the game this kit was extracted from:

- **`beforeunload` does not fire reliably on mobile Safari.** `installFlushTriggers` binds
  `visibilitychange` (guarded on `visibilityState === 'hidden'`) and `pagehide` instead.
- **Private-mode Safari throws on the property access, not just on the write.**
  `browserStorage()` wraps the read of `globalThis.localStorage` itself, then probes with a real
  write, then degrades to memory.
- **JSON quietly destroys `NaN` and `Infinity`** — both serialize to `null`, with a valid
  checksum, and come back as `NaN` on the next tick. Put `expectSerializable` from `core`'s
  `guard` on your currencies inside the head recognizer. It is worth more than a recognizer
  that checks thirty field names and no ranges.
- **A save stores causes, not consequences.** Persist the player's brand hue, never the
  `#rrggbb` it derives to: color derivation is Tier B, so a stored token is an engine-specific
  artifact in a file that will travel to another engine — and a retuned palette would never
  reach anyone who already played.
- **Two live tabs share one key** and the loser's flush wins. The default is last-write-wins;
  `conflict: 'refuse'` costs one extra read per write and reports `WriteSkip: 'conflict'`. It is
  detection, not a lock, and deliberately so — a half-lock that leaks on a crashed tab locks a
  player out of their own game permanently.

---

## A note on the examples in this file

**Anything in this README or in a doc comment that looks like a call is reachable from a test,
and that is a rule rather than an aspiration.** Two examples in this package were once wrong:
one wired `loop.real.after` straight into `schedule`, and one composed a `core` guard that
cannot accept an `unknown`. Both survived a review, a full suite and 100% coverage, because
prose is not compiled and nothing was checking it.

The lesson is narrower and more useful than "keep the docs current". **A run-tested example and
a hand-written one are indistinguishable to a reader, and are read with equal trust** — nobody
copies the snippet that happens to be under test, they copy the one nearest the symbol they are
looking at. So an example here either compiles and runs somewhere, or it is marked as a sketch.
The cheapest way to keep that honest is to paste the doc's example into a test file verbatim
and let `tsc` and `vitest` own it from then on, which is what
`test/migrate.test.ts > the Recognize example from the doc comment, verbatim` and
`test/store.test.ts > scheduleFrom` now do.

---

## What is deliberately absent

Async adapters and promises anywhere in the surface (the page does not await a `pagehide`);
cross-tab leader election; encryption, obfuscation and anti-tamper (a save the player cannot
edit needs a server the player cannot edit); cloud sync; a schema language; a pluggable payload
codec; compression; save slots (a slot is a second store on a second key); undo and rewind;
a migration chain for replays; version skipping; timers and clocks; a
`resetEverything()`; and a settings-store convenience wrapper.

Each of those has an argument behind it in `docs/rfc/persist.md` §5. Read it before adding one
back.

---

## API

| | |
|---|---|
| **integrity** | `Checksum`, `defaultChecksum` |
| **adapters** | `StorageLike`, `StorageAdapter`, `webStorage`, `memoryStorage` |
| **chain** | `Increment`, `Recognize`, `MigrationStep`, `MigrationChain`, `ChainBuilder`, `migrations` |
| **envelope** | `Envelope`, `FailureReason`, `ReadFailure`, `OpenResult`, `inspect`, `elapsedSince` |
| **store** | `StoreOptions`, `Store`, `createStore`, `StoreStatus`, `WriteSkip`, `WriteFailure`, `WriteResult`, `Rejected`, `Schedule`, `Cancel`, `SecondsTimeline`, `scheduleFrom`, `AutosaveOptions`, `Autosave` |
| **replay** | `ReplayCompat`, `Digest`, `Checkpoint`, `ReplayLog`, `RecorderOptions`, `Recorder`, `createRecorder`, `Refusal`, `Divergence`, `ReplayVerdict`, `ReplayVerifier`, `createVerifier` |
| **browser** | `ListenerTarget`, `FlushTargets`, `installFlushTriggers`, `browserStorage`, `VERSION` |

`src/browser.ts` is the only module that names a host global, and it declares itself
`@browser-only` in its header. Everything else runs unchanged under plain `node`.
