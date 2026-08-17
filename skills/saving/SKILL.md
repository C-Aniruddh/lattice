---
name: saving
description: Keeping a player's progress across a reload, a crash and a version bump. Use for saving a game, autosave, load, "my save is gone", "it forgot my progress", changing the shape of saved data, migrations, a reset or start-over button, or when a player on an old build might open a newer save.
---

# Saving

Three ideas, and every failure mode in this skill follows from one of them.

- **The chain *is* the version.** `createStore` reads the current version off the migration
  chain's head, so declaring version 7 while shipping a chain that ends at 6 is not a bug you can
  write down.
- **Every failure is a value.** `open()` never throws, for any content whatsoever. Seven ways a
  save fails to become a state, and every one degrades to a fresh game *with a report*.
- **A save stores causes, not consequences.** Persist the player's brand hue, never the
  `#rrggbb` it derives to.

The alternative to a chain — `parsed.version === SAVE_VERSION` with a fallback to `newGame()` —
is not a migration policy. It is a delete. The game this kit was extracted from said so in its
own source: *"a bump is not a migration — it is a deletion of every player's campus."*

---

## A save, its chain, and its autosave

```ts
import { asEpochMillis } from '@lattice/core';
import { browserStorage, createStore, migrations, scheduleFrom } from '@lattice/persist';
import type { Recognize } from '@lattice/persist';
import type { Loop } from '@lattice/loop';

interface V1 { readonly version: 1; readonly coins: number }
interface V2 { readonly version: 2; readonly wallet: { readonly coin: number }; readonly hue: number }

// A recognizer returns the value TYPED, or throws naming the field. Never a boolean —
// a boolean has already discarded the value that was wrong, so it cannot name it.
const isV1: Recognize<V1> = (value) => {
  const coins = (value as { coins?: unknown }).coins;
  if (typeof coins !== 'number' || !Number.isFinite(coins)) {
    throw new RangeError(`save.v1.coins: expected a finite number, got ${String(coins)}`);
  }
  return { version: 1, coins };
};

const isV2: Recognize<V2> = (value) => {
  const v = value as { wallet?: { coin?: unknown }; hue?: unknown };
  const coin = v.wallet?.coin;
  // Number.isFinite is the load-side guard that matters: JSON turns Infinity and NaN into
  // `null`, under a valid checksum, and they come back as NaN on the next tick.
  if (typeof coin !== 'number' || !Number.isFinite(coin)) {
    throw new RangeError(`save.v2.wallet.coin: expected a finite number, got ${String(coin)}`);
  }
  const hue = typeof v.hue === 'number' && Number.isFinite(v.hue) ? v.hue : 28;
  return { version: 2, wallet: { coin }, hue };
};

const chain = migrations(1, isV1)
  .step(2, 'one coin counter became a wallet', (v1) => ({
    version: 2 as const, wallet: { coin: v1.coins }, hue: 28,
  }), isV2)
  .seal();

export function openSave(loop: Loop) {
  const store = createStore({
    key: 'lighthouse:save',
    chain,
    adapter: browserStorage(),
    fresh: (): V2 => ({ version: 2, wallet: { coin: 0 }, hue: 28 }),
    // REQUIRED, and it has no default on purpose. See below.
    now: () => asEpochMillis(Date.now()),
  });

  const opened = store.open();     // never throws, whatever is in storage
  let live: V2 = opened.state;

  const auto = store.autosave(() => live, { schedule: scheduleFrom(loop.real) });
  return { store, opened, auto, set: (next: V2) => { live = next; } };
}
```

**`scheduleFrom(loop.real)`, never `loop.real.after`.** The loop schedules in seconds and returns
a timer id; this package schedules in milliseconds and wants a cancel function. Passing the
method directly does not compile — and *cast through*, it asks for a write every 4,000 **seconds**,
so the game autosaves once every 67 minutes while the status reports `ok` the whole time.

**Whatever you pass as a schedule must keep firing in a hidden tab.** `requestAnimationFrame` is
0 Hz when the tab is backgrounded, which is precisely the moment before a tab is closed. That is
why it is `loop.real` and not `loop.sim`.

And in a browser, one more line:

```ts
import { installFlushTriggers } from '@lattice/persist';
import type { Autosave } from '@lattice/persist';

export function flushOnLeave(auto: Autosave): () => void {
  return installFlushTriggers(auto, { visibility: document, page: window });
}
```

**`beforeunload` does not fire reliably on mobile Safari.** `installFlushTriggers` binds
`visibilitychange` (guarded on hidden) and `pagehide` instead. The disposer it returns
deliberately does **not** flush — a disposer that writes is the same bug wearing a different hat.

---

## Every failure is a value, and one of them is not a failure at all

| reason | what happened | writable after? |
|---|---|---|
| `unreadable` | storage itself refused to be read | yes |
| `malformed` | not JSON, or not an envelope — something else wrote to this key | yes |
| `corrupt` | checksum mismatch, or a payload that did not parse | yes |
| `future` | the save is newer than this build | **no** |
| `orphaned` | the save is older than the chain floor | yes |
| `migration-failed` | a rung threw, or a step's recognizer rejected its own output | yes |
| `invalid` | reached the head and the head recognizer still refused | yes |

**`source: 'fresh'` with `firstRun: false` is a save that was lost.** They are separate fields for
exactly that reason, and a game that cannot tell the two apart will report a healthy funnel while
quietly losing people.

**A save from the future makes the store read-only, and that is the most important row.** The
player opened a stale deploy — a cached `index.html`, a service worker, a second device on an old
build. Their v9 save is fine; the v7 build cannot read it. Degrading to fresh is correct *in
memory* and catastrophic *on disk*, because the old build would autosave four seconds later and
overwrite a good save with an empty game. So `future` is the one reason that also sets
`writable: false`, every write then skips, and storage comes out of the session byte-identical.

The unreadable text is copied to `${key}:rejected` and read back through `store.rejected()`.
Degrading to fresh without keeping the bytes destroys the only copy of the bug that just ate a
player's progress.

---

## Telling the player, without saying anything technical

`store.status` is one of four bare string literals, most severe first. **It never carries a
timestamp, an attempt count, a byte size or a version number** — interpolating a detail defeats a
latch in exactly the case the latch exists for, because the autosave rediscovers a full quota
every four seconds and a status that differs each time is shown each time.

| status | what the player loses by missing it | so it is |
|---|---|---|
| `refusing-newer` | the whole session, silently, and they cannot tell | a modal they must acknowledge |
| `write-failing` | everything since the last good write, growing | a modal if it persists |
| `not-persistent` | this session, once they close the tab | a toast, latched once |
| `ok` | nothing | nothing |

**The choice is not how alarming the message sounds. It is what the player loses by missing it.**
A modal about a hypothetical blocks a first-time player at the door; a toast about a session that
will not survive the tab closing expires unread.

```ts
import type { Store } from '@lattice/persist';

export function tell(store: Store<unknown>, toastOnce: (k: string, m: string) => void): void {
  if (store.status === 'not-persistent') {
    toastOnce('storage-not-persistent', 'This browser may not keep your progress.');
  }
}
```

Latch on the **condition**, never on the rendered text: a message carrying a byte count changes on
every rediscovery and defeats a deduplication written for precisely that case.

`status` is readable the moment `open()` returns, before a single tick, because the newer-save
case has to reach a player whose session has not started.

---

## Reset closes before it removes

```
close the store to writes  →  stop every autosave handle  →  remove the key and its quarantine
```

`localStorage.clear()` followed by a reload does **not** reset a game: the live autosave flushes
on `pagehide` and writes the state back over the clear. `store.reset()` does it in the order that
works, and after it returns no code path in the package writes to the adapter until `open()` is
called again.

`reset()` is scoped to **one store**. There is no `resetEverything()`: it would be four lines and
it would put the player's volume back at full at one in the morning.

---

## The trap that will find you: `hashString` walks UTF-16 code units

Two consequences pull in opposite directions, and which applies depends on whether you are
hashing *text a human means* or *bytes a machine wrote*.

```ts
import { hashString } from '@lattice/core';
import { defaultChecksum } from '@lattice/persist';

// A key derived from something a player typed. NORMALIZE FIRST, ALWAYS.
// macOS hands you NFD; Windows and most browsers hand you NFC. Without this, the same
// visible name typed on two machines produces two save keys and two different worlds —
// and the bug reproduces on nobody's machine.
export function keyFor(playerName: string): string {
  return `game:save:${hashString(playerName.normalize('NFC')).toString(36)}`;
}

// A checksum over a payload. NEVER normalize — the bytes are the subject, and a save
// truncated mid-combining-sequence must fail.
export function checksum(payloadText: string): string {
  return defaultChecksum(payloadText);
}
```

Ask which of the two you have before you reach for `normalize`.

---

## Five more, mined from a game that shipped

- **Private-mode Safari throws on the property access, not just on the write.**
  `browserStorage()` wraps the read of `localStorage` itself, then probes with a real write, then
  degrades to memory. Do not hand-roll this.
- **JSON quietly destroys `NaN` and `Infinity`** — both serialize to `null`, with a valid
  checksum, and come back as `NaN` on the next tick. A `Number.isFinite` check on every currency
  inside the head recognizer is worth more than a recognizer that checks thirty field names and
  no ranges.
- **Two live tabs share one key** and the loser's flush wins. The default is last-write-wins;
  `conflict: 'refuse'` costs one extra read per write. It is detection, not a lock, deliberately
  — a half-lock that leaks on a crashed tab locks a player out of their own game permanently.
- **`Autosave` has no dirty check.** A player standing still still writes the same bytes on every
  tick, and `minWriteIntervalMs` is the only lever. Three seconds is a reasonable floor for a
  short session: at 1,000 ms a "saved 0s ago" readout says `0s` forever, which proves a save is
  happening and proves nothing about when.
- **The economy's node list is the save's field order.** If you are saving a `sim` ledger, adding
  a node in v4 must go on the end, and a node added purely as a modelling workaround is a field
  in every save file forever.

---

## `now` has no default, and the reason is worth reading once

`now` is a required field. Defaulting it to `() => 0` would be the worst bug in this package's
reach: every save would load with an elapsed of zero, offline progress would pay out nothing, and
**nothing would look broken.**

Keep the one `Date.now()` on a single greppable line in your boot. It never reaches a tile, a
hash or a pixel, so the world stays deterministic.

---

## A replay is evidence, and evidence is never migrated

| | **save** | **replay** |
|---|---|---|
| old format | migrated, rung by rung | **refused** — `orphaned` |
| mechanism | a chain from floor to head | a chain with **no rungs**: `migrations(N, isLog).seal()` |
| near-miss | tolerated; a recognizer may normalize as it validates | **refused, by name** |
| failure costs | a player's progress | a test result nobody should have trusted |

A session recorded at a 16.667 ms step and replayed at 20 ms produces a **confident wrong
answer**, which is worse than a refusal. So a replay store is an ordinary `createStore` whose
chain's floor equals its head — no second code path, and an old replay reads as `orphaned`
through machinery that already exists.

---

## Testing a chain

One fixture per historical version, from the floor up, fed through `store.decode`. Compile-time
and construction-time checks catch a *hole* in the chain three ways; only a fixture catches a
rung that exists and is **wrong**, which is the failure that actually ships.

---

## What this skill does not cover

| you want | read |
|---|---|
| the loop that drives the autosave schedule | `starting` |
| offline progress arithmetic, and what a stored price costs you | `economy` |
| the modal or toast that reports a status | `hud` |
| replays, divergence and cross-engine agreement | `determinism` |

Long form, on disk: `node_modules/@lattice/persist/README.md`.
