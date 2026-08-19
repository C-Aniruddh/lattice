# Audit — `@latticekit/persist`

Task C7. Adversarial, not a code review: the object was to break the promises the package makes
about itself and report what held.

Everything below was run against `packages/persist/dist` on Node 24 / V8 / darwin-arm64, with
`memoryStorage` and with hand-built adapters that throw. Probe scripts were throwaway and are not in
the repo; every finding carries the snippet that reproduces it.

**Twelve findings: 2 high, 4 medium, 6 low.** The two high ones are the same shape — *damage that
loads clean* — approached from opposite ends of the envelope.

---

## What was attacked

The six invariants in `.lattice/kit.json`, plus every "breaks as" row in `docs/SEAMS.md` that names
this package.

| claim | attacked with | verdict |
|---|---|---|
| The chain **is** the version | a chain with a hole, a backwards rung, a self-step, a fractional floor, a negative floor | held (one runtime/type disagreement, PERSIST-12) |
| One rung per migration, every rung recognizes | a save migrated twice; a save whose `v` was tampered downward | held against a strict recognizer, **broken against a loose one — PERSIST-1** |
| Seven closed reasons, never a throw on boot | all seven reached; not-JSON, JSON-of-another-shape, `null` payload, bad checksum, intact checksum over non-JSON, unreadable storage | held |
| A save from the future makes the store read-only | a real future save, and a corrupted `v` | held, and **that is the problem — PERSIST-1** |
| `reset()` closes handles before removing the key | scheduled autosave + reset + fire the timer | held |
| A replay log is evidence, never migrated | an old log, a mismatched `stepMs`, a mismatched profile, zero marks, a skipped checkpoint | held; one laundering path — PERSIST-6 |
| Options readable back (non-negotiable 11) | `StoreOptions`, `AutosaveOptions`, `RecorderOptions` | **broken — PERSIST-5** |
| `Infinity` through JSON (SEAMS) | `save({ gold: Infinity })` | **broken — PERSIST-2** |

---

## Findings

### PERSIST-1 · high · the checksum covers the payload and not the envelope, so `v`, `t` and `n` are unprotected

`store.ts` explains why `d` is a JSON *string* rather than a nested object:

> the checksum then covers the exact bytes read, not a re-serialization of a parse.

It covers the exact bytes of the **payload**. The three header fields that decide *which migrations
run*, *how much offline time is owed* and *who wins a cross-tab race* sit outside it. Each of the
three has its own consequence, and each is reachable with a one-character edit that leaves the
checksum valid.

Setup — a three-version chain with the loose recognizers `migrate.ts` explicitly advises
("Make it as loose as you can defend"):

```js
import { migrations, createStore, memoryStorage, defaultChecksum, elapsedSince } from '@latticekit/persist';
import { expectObject, asEpochMillis } from '@latticekit/core';

const loose = (v) => expectObject(v, 'save');
const chain = migrations(1, loose)
  .step(2, 'double the gold', (o) => ({ ...o, gold: (o.gold ?? 0) * 2 }), loose)
  .step(3, 'add tick',        (o) => ({ ...o, tick: 0 }), loose)
  .seal();

const adapter = memoryStorage();
const store = createStore({ key: 's', chain, adapter,
  fresh: () => ({ gold: 0, tick: 0 }), now: () => asEpochMillis(1_700_000_000_000) });

store.open();
store.save({ gold: 100, tick: 5 });
const good = adapter.get('s');
// {"v":3,"t":1700000000000,"n":1,"c":"c71b3301","d":"{\"gold\":100,\"tick\":5}"}
```

**(a) `v` tampered upward — permanent, silent, unquarantined loss of every future session.**

```js
adapter.set('s', good.replace('"v":3', '"v":9'));   // one character; `c` untouched and still valid
const o = store.open();

o.failure.reason;        // 'future'
o.failure.quarantined;   // false   — `future` is exempt from quarantine by design
store.status;            // 'refusing-newer'
store.writable;          // false
store.save({ gold: 1 }); // { written: false, bytes: 0, skipped: 'not-writable', error: null }
store.rejected();        // null    — no evidence was kept
```

The message the game's developer sees is *"the player has an older deploy. Storage was left
untouched and this store will not write."* That is false, and it is the one sentence that will send
them to look at their deploy pipeline instead of at the save. From here on the store never writes
again, for the life of the install, with `status: 'refusing-newer'` as the only signal — and
`reset()` (which deletes the save) is the only escape. This is precisely the failure the `future`
reason was invented to *prevent*, arrived at from the wrong direction.

**(b) `v` tampered downward — a double migration that no layer detects.**

```js
const d = store.decode(good.replace('"v":3', '"v":1'));

d.source;         // 'save'
d.failure;        // null
d.migratedFrom;   // 1
d.state;          // { gold: 200, tick: 0 }   — the gold rung ran a second time
```

A save is read as a version older than it is, run back through the whole chain, and comes out with
its currency doubled, `source: 'save'`, `failure: null`. `migrate.ts`'s whole thesis is that
"a bump is not a migration — it is a deletion of every player's campus"; this is the mirror image —
a *re*-migration that is neither refused nor reported. A strict recognizer catches it (see "what
held"), but strict recognizers are exactly what the module advises against.

**(c) `t` tampered — free offline accrual, and no failure.**

```js
const d = store.decode(good.replace(/"t":\d+/, '"t":1'));
d.failure;                                            // null
elapsedSince(d, asEpochMillis(1_700_000_000_000));    // 1699999999999  ≈ 19,676 days
```

`elapsedSince`'s doc says it is "not clamped from above" because an offline cap is `sim`'s balance
decision. That is right, and it means a single damaged digit in `t` hands `sim` fifty-four years to
integrate over.

**Consequence, in one line.** The checksum is currently a payload checksum wearing an envelope
checksum's job description. Damage that changes *how the payload is interpreted* is undetectable.

**Fix shape (not applied — this is an audit).** Checksum the header with the payload:
`checksum(\`${v}|${t}|${n}|${d}\`)`. It is a format change, so it needs its own rung and a
read-both-ways window. A cheaper partial fix — bounding `v` — is PERSIST-9.

---

### PERSIST-2 · high · `Infinity`, `NaN` and `-0` are laundered by the write path with a valid checksum, and nothing in the package looks

`SEAMS.md` states the rule this package exists downstream of:

> `Infinity` is a perfectly Tier A result and is precisely the value that does not survive being
> written down — it serializes to `null`, with a valid checksum, so no layer downstream can detect
> it.

It is still true, and `persist` neither catches it nor reports it.

```js
const store = createStore({ key: 'k', chain, adapter, fresh: () => ({}), now });
store.open();

store.save({ gold: Infinity, debt: -Infinity, ratio: NaN, neg: -0 });
// { written: true, bytes: 115, skipped: null, error: null }

adapter.get('k');
// {"v":1,"t":1000000,"n":1,"c":"5bda85b1","d":"{\"gold\":null,\"debt\":null,\"ratio\":null,\"neg\":0}"}

const o = store.open();
o.source;    // 'save'
o.failure;   // null
o.state;     // { gold: null, debt: null, ratio: null, neg: 0 }
```

`written: true`. A valid checksum over `null`. A clean read. An infinite stock returns as nothing
and a `-0` returns as `0`, and the only thing that could have said so is a recognizer the game
wrote, on the *read* path, one save too late — by which time the real value is gone.

`core` ships `expectSerializable` for exactly this, and its doc says where the check belongs:

> That is the worst corruption shape in the kit: the bytes are intact, the checksum matches, the
> schema is the right shape, and an infinite stock silently returns as nothing. No layer downstream
> can detect it, **which is why the check belongs at the moment of writing rather than the moment of
> reading.**

`persist` imports `isSerializable` and uses it on two fields — the envelope's own `t` and `n` in
`inspect()`. It never applies either guard to the payload. The moment of writing is
`envelopeText()`, and there is nothing there.

**The suite does not test this either.** `Infinity` appears **zero** times across
`packages/persist/test/*.ts`. The one place in the repo that gets it right is
`examples/migration/src/chain.ts` — a *game-layer* recognizer, in an exhibit built specifically to
demonstrate the trap.

**Consequence.** The single hardest failure in the kit to diagnose from a bug report, in the one
package positioned to make it impossible, with a guard already sitting in its own dependency.

**Fix shape (not applied).** This is a policy decision, not a one-liner, and that is the reason it
is a finding rather than a patch: walking the whole state on every four-second write costs real time
on a phone. The candidates are (i) walk and refuse in `envelopeText`, reporting a new
`WriteFailure.reason: 'unserializable'`; (ii) a cheaper post-hoc check —
`if (d.includes('null'))` is not sound, but comparing `JSON.parse(d)` against the input is; (iii)
make it opt-in as `StoreOptions.strictNumbers`, defaulting on in development. Someone has to choose;
today nobody has.

---

### PERSIST-3 · medium · a non-finite `now()` writes an envelope the store reads back as `malformed`, and the message blames a third party

```js
const store = createStore({ key: 'k', chain, adapter, fresh: () => ({}), now: () => Infinity });
store.open();

store.save({ version: 1 });
// { written: true, bytes: 59, skipped: null, error: null }
adapter.get('k');
// {"v":1,"t":null,"n":1,"c":"d005553c","d":"{\"version\":1}"}

const o = store.open();
o.failure.reason;    // 'malformed'
o.failure.message;   // 'persist: save "k" is not a Lattice envelope … Something else has written to this key.'
```

`inspect()` applies `asEpochMillis` on the way *in* and validates `t` with `isSerializable`.
`envelopeText()` applies neither on the way *out* — it writes `t: now()` raw. So the store produces
a save only it could have produced, cannot read it, and reports it as somebody else's doing. Every
subsequent boot degrades to fresh and quarantines the evidence.

`StoreOptions.now` is typed `Now = () => EpochMillis`, so reaching this needs a cast or an untyped
JavaScript caller — which is exactly the population `expectSerializable`'s doc, `asEpochMillis`'s
doc and `expectObject`'s doc are each written for. `createStore` already validates that `now` is a
*function*; it does not validate what it returns, at the one call per write where it would cost one
comparison.

---

### PERSIST-4 · medium · the autosave interval is measured on the calendar clock, so a backwards clock jump stalls it silently

`Autosave.tick()` subtracts two `EpochMillis` and compares the difference against
`minWriteIntervalMs`. `core/time.ts` says what an `EpochMillis` does:

> It can also jump *backwards*: an NTP correction, a timezone change, or a player setting their
> clock forward to skip a build timer all move it. Anything that subtracts two of these must
> tolerate a negative result.

`tick()` does not.

```js
let t = 1_700_000_000_000;
const store = createStore({ key: 'k', chain, adapter: durable, fresh: () => ({}), now: () => asEpochMillis(t) });
store.open();
const auto = store.autosave(() => ({ gold: t }));

auto.tick();          // true   — writes
t += 5000;
auto.tick();          // true   — writes
const before = cells.get('k');

t -= 3_600_000;       // the clock steps back one hour
const ticks = [];
for (let i = 0; i < 10; i++) { t += 60_000; ticks.push(auto.tick()); }

ticks;                // [false,false,false,false,false,false,false,false,false,false]
store.status;         // 'ok'
store.writable;       // true
auto.lastWrite;       // { written: true, … }   — still showing the last successful write
cells.get('k') === before;   // true  — nothing has been written for ten simulated minutes
```

Ten minutes of play produce no write, `status` says `'ok'`, `writable` says `true`, and `lastWrite`
still reports success. The stall lasts as long as the jump: after a one-hour correction, an hour.

**Consequence.** Setting the clock forward to skip a build timer and then back is a first-class idle
game behavior — `time.ts` names it by name — and so are DST and NTP. A player doing it loses
autosave for the duration with no indication whatsoever. It is medium and not high only because
`flush()` is on a different path: `installFlushTriggers` still writes on `visibilitychange` and
`pagehide`, so the loss is bounded to a crash, a kill, or a tab that is closed without either event
firing. Nothing reports the condition.

**Note on the fix.** Not "use a monotonic clock" — this package deliberately has only the calendar,
and taking a `MonotonicNow` would be a second clock in a kit whose rule is that a game contains
exactly one thing that decides when work happens. The minimal correct change is to treat a negative
elapsed as "the interval has passed": `at - lastAttemptAt < minWriteIntervalMs && at >=
lastAttemptAt`.

---

### PERSIST-5 · medium · non-negotiable 11 across three options objects

> **An option a caller supplied is a value they can read back.** Every field of every `*Options`
> object is readable off the object it configured. **No exceptions.**

| options object | fields in | readable off the result |
|---|---|---|
| `StoreOptions` | 13 | `key`; `version` (via `chain.head`) |
| `AutosaveOptions` | 1 | none |
| `RecorderOptions` | 6 | none |

```js
const store = createStore({ key: 'k', chain, adapter, fresh, now,
  minWriteIntervalMs: 9999, maxBytes: 123456, conflict: 'refuse', quarantine: { maxBytes: 10 } });

['minWriteIntervalMs','maxBytes','conflict','quarantine','checksum','adapter','now','fresh','chain','durable']
  .map((k) => k in store);
// [false,false,false,false,false,false,false,false,false,false]

'schedule' in store.autosave(() => ({}));   // false
Object.keys(createRecorder({ … }));         // [ 'mark', 'checkpointCount', 'stop' ]
```

**Consequence.** `durable` is the sharpest case. A game wants to tell a private-mode player at the
door that this session will not survive — the package's own argument for the field — and cannot ask
until after `open()`, or must decode it out of `status === 'not-persistent'`, which also encodes
two other conditions and is documented as being masked by them. `minWriteIntervalMs` is the second:
a settings panel offering "save every N seconds" must hold its own copy of N, and two copies drift.
This is the same defect already filed as K14 (`iso`), K18 (`audio`), K19 and K34 (`draw`) — the rule
has three open tasks against it and `persist` is the fourth package.

**Settability**, per the rule's three-part test, is a separate question and mostly answers "baked":
`chain`, `adapter` and `key` are **identity** (a save already written depends on them);
`checksum` is **record** (changing it invalidates every save this build wrote). `minWriteIntervalMs`
and `maxBytes` fail all three tests and could be settable. But the finding is only about *reading*,
where there is no counter-argument.

---

### PERSIST-6 · medium · a non-finite digest turns a clean replay into a divergence that names nothing real

A `Digest<T>` returning `Infinity` is a legal Tier A result — SEAMS says so in as many words. Store
the log (which is what `replay.ts` tells you to do) and the digest becomes `null`:

```js
const rec = createRecorder({ kit: 'k', game: 'g', rng: { seed: 0, state: 0 },
  startTick: 0, digest: () => Infinity, checkpointEvery: 5 });
rec.mark(0, {});
const log = JSON.parse(JSON.stringify(rec.stop(5, {}, { version: 1, stepMs: 16, profile: 'p' })));

log.checkpoints;   // [ { tick: 0, digest: null }, { tick: 5, digest: null } ]

const v = createVerifier(log, { kit: 'k', game: 'g',
  inputs: { version: 1, stepMs: 16, profile: 'p' }, digest: () => Infinity });
v.mark(0, {});
v.finish();
// { matched: false, checkpointsChecked: 0,
//   divergence: { tick: 0, lastAgreedTick: 0, expected: null, actual: Infinity, checkpointIndex: 0 },
//   refused: null }
```

The run did **not** diverge. The log did. `Divergence.expected` is typed `number` and is `null`, and
the report brackets a bug that does not exist. `replay.ts`'s header says a divergence report that
cannot be trusted "puts the determinism claim back where it started while looking like it has been
tested" — this is that, produced by the package itself.

`createRecorder` validates that `digest` is a function and that `checkpointEvery` is a positive
integer. It never looks at what `digest` returns, at the one moment per checkpoint where a
`expectSerializable(digest(state), 'recorder.digest')` would cost nothing measurable (digests run on
1 tick in 600).

Related but distinct, and already filed: **K62** covers `matched: false` with `divergence: null` and
`refused: null` for a recording started mid-game. I confirmed two more routes to the same
uninformative verdict — a driver that never calls `mark`, and a driver that skips the exact tick a
checkpoint sits on — but both are the documented "stopped early" case, so they are correct behavior
rather than a second finding.

---

### PERSIST-7 · low-medium · with `conflict: 'refuse'`, a tab that loses once can never write again

`sequence` only advances on a *successful* write, and `conflicted()` compares against it, so once
another tab is ahead the losing store is permanently mute.

```js
const a = mk(), b = mk();           // two stores, one key, conflict: 'refuse'
a.open(); b.open();
a.save({ who: 'a' });               // written

[0,1,2,3,4].map(() => b.save({ who: 'b' }).skipped);
// [ 'conflict', 'conflict', 'conflict', 'conflict', 'conflict' ]
b.status;     // 'ok'
b.writable;   // true

b.open(); b.save({ who: 'b' }).written;   // true — the only way back
```

`b` reports `status: 'ok'` and `writable: true` while writing nothing, forever. The option's doc
explains what `'refuse'` detects and stops there: it does not say that recovery requires `open()`,
and `open()` replaces the live state with what is on disk, so a game following the documentation has
no non-destructive path back. The doc's argument for detection-not-locking is right; the missing
half is what a game is supposed to *do* on the second `'conflict'`.

---

### PERSIST-8 · low · `createRecorder` does not check the one field the whole replay rests on

```js
const log = createRecorder({ kit: 'k', game: 'g', rng: { seed: -1, state: 1e21 },
  startTick: 0, digest: () => 1 }).stop(0, {}, { version: 1, stepMs: 16, profile: 'p' });

log.rng;   // { seed: -1, state: 1e+21 }   — sealed into the log, no complaint

Rng.fromSnapshot(log.rng);
// RangeError: Rng.fromSnapshot: expected uint32 seed and state, got seed=-1, state=1e+21
```

The error arrives much later, in a different package, naming `core`'s function rather than the
`RecorderOptions.rng` that was wrong (non-negotiable 9). `replay.ts` calls this field the thing that
makes a replay work — "A log that restores a seed but not the cursor re-rolls every draw the session
had already spent, and it looks correct for the first few draws, which is what makes it expensive" —
and it is the only recorder option not validated.

`Recorder.mark` also accepts a fractional or negative tick (`mark(1.5, state)` returns `true` and
records a checkpoint at `1.5`), which no verifier can ever match, since `mark` compares
`checkpoint.tick !== tick` exactly. SEAMS pins the tick index as "starts at 0, increments by exactly
one, and never skips or repeats"; `persist` stores it and does not check it.

---

### PERSIST-9 · low · the envelope's `v` is unbounded, so damage is indistinguishable from a newer deploy

```js
[1, 0, -1, 1.5, 1e21, Number.MAX_SAFE_INTEGER, 2 ** 53].map((v) => store.decode(env(v)).failure?.reason ?? 'ok');
// [ 'ok', 'orphaned', 'orphaned', 'malformed', 'future', 'future', 'future' ]
```

`Number.isInteger(1e21)` is `true`, so `"v":1e21` sails through `inspect()` and reads as `future` —
permanently read-only, nothing quarantined. `core` ships `expectSafeInteger` for exactly the "this
number has left the exactly-representable integers" case and it is not applied here. A sanity bound
on `v` — say, `0 <= v <= head + 1000` — turns most corruptions of that field into `malformed`, which
*is* quarantined and *does* degrade to fresh. Cheap, no format change, and it closes the worst half
of PERSIST-1(a).

---

### PERSIST-10 · low · quarantine keeps only the most recent bad boot

```js
adapter.set('q', badSaveA); store.open();
JSON.parse(adapter.get('q:rejected')).text;   // badSaveA

adapter.set('q', badSaveB); store.open();
JSON.parse(adapter.get('q:rejected')).text;   // badSaveB — A is gone
```

`Rejected`'s doc argues that degrading without keeping the bytes "destroys the only copy of the bug
that just ate a player's campus". A boot loop over a broken save destroys it anyway, on the second
boot, before anyone has read a bug report. Low, because the second copy is usually the same damage —
but a game that recovers, writes, and then breaks differently has lost the first.

---

### PERSIST-11 · low · an autosave armed before `open()` re-arms forever

`makeAutosave` calls `arm()` unconditionally, so a handle created on a store in phase `'new'`
schedules a write, the write reports `'closed'`, and the callback re-arms.

```js
const auto = store.autosave(() => ({ gold: 1 }), { schedule });   // store never opened
run(); run(); run();
pending.length;      // 1 — a fresh timer every cycle, forever
auto.lastWrite;      // { written: false, bytes: 0, skipped: 'closed', error: null }
store.phase;         // 'new'
```

Not a memory leak of any size, but it is a self-perpetuating timer on a store that has done nothing,
and the package's stated position is that "a package that creates a timer is a package that owns a
leak". `stop()` is the only exit, and nothing tells a caller they need it.

---

### PERSIST-12 · informational · `migrations()` accepts a floor the type system will not step from

`migrations(-5, r).seal()` returns a chain with `head: -5`. `Increment<-5>` cannot resolve, so
`.step()` on it will not compile. Runtime and types disagree about what a version is. No consequence
found — every save is then either `orphaned` or `future` — but `migrations` already validates
`Number.isInteger(floor)` and a `floor >= 0` would cost one comparison.

---

## What held up best under attack

Several of these are the parts of the package I most expected to break, and they did not.

- **The migration chain refused every hole I could build.** A jump (`step(3, …)` from head 1), a
  backwards rung, a self-step (`step(1, …)` from head 1) — each throws at `seal()` with a message
  naming the missing version and saying why a shortcut is wrong. A fractional floor is refused at
  `migrations()`. `chain.run` refuses an out-of-range, fractional or `NaN` `from`. The compile-time
  half (`Increment<Head>`) and the runtime half agree.
- **All seven failure reasons are reachable, all as values, none as a throw.** I got `unreadable`
  (adapter throws on `get`), `malformed` (not JSON; JSON of another shape; non-finite `t`),
  `corrupt` (checksum mismatch, *and* intact checksum over a payload that will not parse), `future`,
  `orphaned`, `migration-failed` with the correct `atVersion` naming the rung, and `invalid` at the
  head. `decode()` reproduced `open()`'s `writable` for each. Boot never threw for any input I
  could construct, including `null`, `[]`, `"1"`, `""` and a 500 kB blob.
- **A save that has already been migrated is caught, when the recognizer is strict.**
  `chain.run(alreadyMigrated, 1)` throws `save.v1: expected version 1, got 3` and becomes
  `migration-failed` at version 1. The mechanism works; PERSIST-1(b) is about the case where the
  recognizer was written loosely, as advised.
- **`reset()`'s ordering genuinely closes the trap it was written for.** After `reset()` the
  scheduled autosave is cancelled, firing the timer by hand writes nothing, the key and the
  quarantine key are both gone, and `flush()`/`tick()` both report `'closed'`. `installFlushTriggers`
  returns a disposer that does not flush, so the "clear, then the flush on the way out writes it
  back" failure is closed at both ends. This is the best-defended thing in the package.
- **The replay verdict cannot be green without checking.** Zero calls to `mark` gives
  `matched: false, checkpointsChecked: 0`; skipping the exact tick a checkpoint sits on gives
  `matched: false, checkpointsChecked: 1`. `matched` requires `index === log.checkpoints.length`,
  and a refusal forces `matched: false` before the first tick. The failure this field was written
  against — a verifier reporting green over checkpoints it never visited — does not exist.
  Compatibility refusals name the field, the recorded value and the current one.
- **Write failures are values, and the status is stable.** Quota is classified from three different
  browser spellings, `status` becomes `'write-failing'` and clears on the next success,
  `'too-large'` refuses before the platform gets the chance, and `encode()` throws where documented
  while `save()` catches the same failure and reports it. `StoreStatus` never carried a detail.
- **`browserStorage` reads the property inside the `try`** and probes with a real write and remove,
  which is the shape private-mode Safari actually needs.

---

## What I could not test, and why

An audit that claims full coverage is lying. These are the gaps, largest first.

1. **Everything a browser actually does.** `browser.ts` is the module with the two traps this
   package was extracted to answer — `beforeunload` not firing on mobile Safari, and private mode
   throwing on the *property access* — and I tested it against plain objects in Node, which is
   exactly what its own suite does. So the ordering of `visibilitychange` and `pagehide` on a real
   page discard, whether a synchronous `setItem` completes inside a `pagehide` handler, and whether
   the private-mode guard covers today's Safari are all **argued, not observed**. This is the
   largest untested surface in the package and it is not testable from here; it needs a device lab
   or a real browser harness.
2. **A genuine quota.** I simulated one by throwing a `DOMException`-shaped object. I did not test a
   *partial* write — a `setItem` that stores a truncated string — which is the exact damage the
   checksum exists to catch. `memoryStorage` cannot truncate, so the checksum's headline use case is
   verified only against damage I introduced by hand.
3. **Two real tabs.** I simulated cross-tab conflict with two `Store` objects over one adapter.
   They share an event loop and a `Map`; a real pair of tabs interleaves `get` and `set` in ways
   this cannot reproduce, and `conflicted()`'s single extra read is exactly where a real race would
   live.
4. **Cross-engine determinism**, same gap as `core`: `defaultChecksum` is `hashString` and its
   bit-identity across engines is textual, not measured. A save written by V8 and read by
   JavaScriptCore is the case the checksum most needs to survive and the one I could not run.
5. **The chain against real historical fixtures.** `store.test.ts` reads fixture files from disk; I
   exercised `decode()` with hand-built envelopes instead. Whether the *shipped* chains in
   `examples/migration` still reach the head from every historical version is that suite's job and I
   did not re-derive it.
6. **Coverage and size budgets** were not re-measured.
7. **Non-negotiable 10.** Nothing here was seen running in the demo. Whether a `refusing-newer`
   store communicates anything to an actual player is a question for someone looking at a screen.

---

*Findings worth acting on are filed in `.lattice/tasks.json` as `L8`–`L16`. PERSIST-12 is recorded
here and deliberately not filed: no consequence was found.*
