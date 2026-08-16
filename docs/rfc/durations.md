# Durations — a brand in `core`, or a cross-checked pair?

**Task `K23`. Owner: lattice-architect. Status: decided.**

Raised by a builder who was handed an acceptance criterion that described a type the kit does not
have. I wrote that criterion. The decision below is the answer to what should have been written
instead; the audit in §6 is the answer to how far the mistake got before anyone tried to compile it.

---

## 1. The one sentence

> **Brand a *kind*; cross-check a *quantity*. A duration has only one kind, so `core` gets no
> duration brand — and the one duration in this kit with an authoritative source is taken from the
> source rather than typed.**

Two claims, and the second is the one that generalizes.

The first is a correction: `EpochMillis` and `MonotonicMillis` are branded because **two kinds of
millisecond coexist in a running Lattice game and are mutually assignable.** The brand makes one
specific substitution — a stopwatch reading where a calendar instant was wanted — a compile error,
and that substitution is a thing a compiler can see. A duration has no counterpart to be confused
with. There is no second kind of "how long"; there is only a wrong number of them, and **a brand
does not check numbers.** `asMillis(16)` would brand `16` exactly as happily as it brands `16.667`,
which means a duration brand cannot catch the bug that actually happened.

The second is the shape that replaces it. Where a duration has exactly one correct value and
something else in the program already knows it, **take the thing that knows it** — the loop, not the
number the loop publishes. Where the DAG forbids importing that thing's type, declare its shape
structurally and require a second, *derived* view of the same quantity, so a value typed by hand is
arithmetically inconsistent with itself and can be refused at runtime.

And a third claim, stated because it is what stops this RFC being rolled out over the whole kit:
**almost no duration in Lattice qualifies.** §5 counts them. 37 duration-shaped public fields exist
across six packages; exactly one quantity among them has an authoritative source. The rest are
preferences, and a preference with a wrong value is visible on the first frame.

---

## 2. The five-line example

What a caller writes today, after `input` solved this for itself:

```ts
const loop = createLoop({ hz: 60 });
const input = createInput({ element: canvas, camera, step: loop, actions });  // the loop IS the step
const headless = createInput({ element, camera, step: fixedStep(60), actions }); // no loop to read
// `step: 16` does not compile. Neither does `{ stepMs: 16 }` — one field is not the pair.
// `{ stepMs: 16, stepSeconds: 0.016667 }` compiles and is refused by name: 4.2% apart.
```

That is the whole product. The shortest expression that type-checks is `loop`, which is the correct
answer; the shortest expression that type-checks *and* is wrong requires a caller to type two
numbers that disagree, and `resolveStep` names the disagreement.

Compare what the criterion I wrote in `K13` promised:

```ts
createInput({ …, stepMs: someMillis });   // "the branded type exists precisely so this
                                          //  substitution cannot compile"
```

`Millis` is `@lattice/loop`'s, it is `type Millis = number`, its own doc comment says it "guards
nothing", and `loop` is `input`'s **sibling** on the DAG so the import does not exist in either
direction. Three independent reasons the sentence was false, and none of them needed a builder to
discover — all three are readable in the two files the sentence names.

---

## 3. Why the brand could not have worked, in the place it was asked for

The instinct is right and the mechanism is wrong, and the difference is worth stating precisely
because the instinct will recur.

### What `EpochMillis` actually buys

Not "type safety on time". It buys **one specific unrepresentable substitution**, and `core`'s own
`time.ts` says which one: a monotonic reading stamped into a save file, whose origin is the
document, so offline accrual credits the seconds since page load and the report reads *"offline
progress is broken"* rather than *"wrong clock"*. Two values, both `number`, both flowing through
the same code, both plausible at the same call site. That is the exact profile a brand fixes.

It works for a second reason that is easy to miss: **any finite number is a legal `EpochMillis`.**
`asEpochMillis` is honest because the claim it makes — "this is calendar-shaped" — is one the
function can actually verify to the extent it is verifiable at all. `time.ts` even refuses to range
check, and says why: a check that rejected "this looks like seconds" would reject `0` and `1000`,
which is where every manual clock in every test starts.

### What a duration brand would have to claim

`asMillis(x)` would have to claim *"this came from the loop"*, and it cannot know that. A brand is a
**provenance** claim with no way to check provenance — the mint function sees a number. So the brand
would be satisfied by the exact line it was introduced to forbid:

```ts
createInput({ …, stepMs: asMillis(16) });   // compiles, brands, ships, lies by 4%
```

The failure being prevented is not a substitution between two kinds. It is **a plausible value of
the right kind, wrong by 4%**, silent at the site, and surfacing as a long press at 432 ms, a fling
that coasts short, and a `persist` refusal months later naming a mismatch nobody can explain.

### And there is no home for it anyway

| home | what happens |
|---|---|
| `loop` | it is where `Millis` lives today, and a brand there is invisible to every sibling. `input`, `audio`, `ui` and `persist` are all layer-1 or layer-2 peers; non-negotiable 3 forbids the edge, and inventing it to import a *type* is the same design error as inventing it to import a function |
| `core` | reachable by everyone, and therefore mintable by everyone — including the caller typing `16`. A brand that every consumer can mint is documentation with a cast attached |
| `input` | a brand on a value `input` does not produce. It could only be minted by `input`, which means the loop's own step could not be passed without laundering it |

**There is no arrangement in which the brand does the work.** That is not a limitation of this kit's
layering; it is what a brand is. Provenance types work when the mint is a boundary the value must
cross — `asEpochMillis` at the one `Date.now()` the kit permits — and the loop's step crosses no such
boundary, because the loop hands the number over as a plain field of a plain object.

### The four mechanisms, and what each one can see

| mechanism | catches | misses | costs |
|---|---|---|---|
| unit in the name (`stepMs`) | nothing | everything | nothing — and it is still required, §4 tier 3 |
| a brand (`EpochMillis`) | the wrong **kind** of number | the wrong **value** of the right kind | a mint call, and a re-brand after arithmetic |
| a cross-checked pair (`FixedStep`) | a value with no legitimate source | a source that is itself wrong | one extra field on an interface, one comparison at construction |
| taking the owner (`step: loop`) | both | nothing | availability — the owner has to be in scope, and typeable |

`input` reached for the third because the fourth was unavailable *as a type* while being entirely
available *as a value*. That is the interesting part of what it did, and §4 turns it into a rule.

---

## 4. The decision

**No branded duration in `core`. Instead, a three-tier rule, applied per duration rather than per
package, and the tier is decided by one question.**

> ### Is there exactly one correct value, and does something else in the running program already know it?

**If yes**, the duration is *derived* and the caller must not be asked to retype it. Tiers 1 and 2.
**If it is a taste question**, the duration is *authored*, the caller is the only source, and no type
can help. Tier 3, which is most of the kit.

### Tier 1 — take the owner

Take the object that owns the value, not the number it publishes.

```ts
createInput({ …, step: loop })
```

This is strictly the best answer whenever it is available, and it is worth reaching for before
tier 2 every time, because it is the only one of the three with **no way to be wrong**. There is no
literal to mistype, no pair to reconcile, and the coupling is structural rather than nominal — the
consumer declares the shape it needs and the owner satisfies it without knowing the consumer exists.

### Tier 2 — declare the owner structurally, with a *derived* second view

When the DAG forbids importing the owner's type — which is the normal case between siblings —
declare the shape locally and require a second field that comes from **the same computation** as the
first, so a hand-typed pair is arithmetically inconsistent.

```ts
export interface FixedStep {
  readonly stepMs: number;
  readonly stepSeconds: number;   // never read; it exists to be checked against stepMs
}
```

Two properties, and both are load-bearing:

1. **A single field is not the pattern.** `{ stepMs: 16 }` is one keystroke from a literal and would
   type-check. The pair makes the shortest type-checking argument the loop itself.
2. **The second view must be *derived*, not *duplicated*.** `loop` computes both from one integer
   microsecond count — `u/1e3` and `u/1e6` — so across every legal `hz` from 1 to 1,000,000 they
   agree to within one ulp (`2.21e-16` worst case, measured). A caller who writes
   `{ ms, seconds: ms / 1000 }` produces a pair that agrees perfectly and proves nothing. **The check
   is only as strong as the independence of the two views**, and independence here comes from both
   being rounded off one integer rather than one being computed from the other.

And the escape hatch for callers with no owner to read — a headless replay, a test, a component page
— is a constructor that runs *the owner's own arithmetic*: `fixedStep(hz)` produces `16.667`, not
`1000/60`, because `persist` compares the recorded `stepMs` for exact equality and the twelfth
decimal place is the difference between a log that replays and one that is refused.

### Tier 3 — a bare `number` with the unit as the last word of the name

For every duration whose correct value is a preference: `longPressMs`, `flingHalfLifeMs`,
`minGapMs`, `budgetMs`, `standaloneMs`, `atSeconds`, `uncappedSeconds`. There is no authority to
take it from, no second view to check it against, and **a wrong value here is visible in the first
ninety seconds** — a long press that fires late is a feel complaint, not a silent 4% error that
surfaces in a replay refusal months later.

The unit in the name is the entire mechanism and it is not nothing: `loop`'s clock module already
draws the kit's one unit boundary — *options in milliseconds, callbacks in seconds* — and says
plainly that "the only defense against that is the naming convention above." That is correct and
this RFC ratifies it. What it must not do is wear a type alias that implies more (§7).

### Why the tiers, and not "structural pairs kit-wide"

`input`'s argument is that a cross-checked pair is self-verifying in a way a brand is not, and it is
right — but the argument only holds where there is something to verify *against*. A pair is a
redundancy check, and redundancy requires a source of truth to be redundant with. `longPressMs` has
no second view; inventing `longPressSeconds` beside it would let a caller mistype both consistently
and would buy exactly nothing. **The pair is not a better way to type a duration. It is a way to
prove a duration came from its owner**, and it applies where and only where an owner exists.

---

## 5. The kit, audited against the tiers

Every duration-shaped public field reachable from a package's `index.ts`, by the grep that finds
them:

```
$ grep -rhE "readonly [a-zA-Z]*(Ms|Seconds)\??:" packages/*/src/*.ts | wc -l
37                          # across audio, input, loop, persist, sim, ui
$ grep -rhE "readonly (stepMs|stepSeconds)\??:" packages/*/src/*.ts | wc -l
11                          # every one of them the same quantity, in four packages
```

| tier | count | which |
|---|---|---|
| **1 / 2** | **1 quantity**, appearing as 11 fields | the fixed step: `loop.stepMs` / `loop.stepSeconds`, `input`'s `FixedStep`, `InputLog.stepMs`, `ReplayCompat.stepMs`, `ReplayOptions.stepMs` |
| **3** | 25 fields | `audio`: `minGapMs`, `ladder.windowMs`. `input`: `longPressMs`, `flingHalfLifeMs`, `flingSampleMs`, `heldMs`. `loop`: `idleMs`, `maxCatchUpMs`, `budgetMs`, and the five reported measurements in `FrameStats` (`frameMs`, `updateMs`, `renderMs`, `worstFrameMs`, `droppedSeconds`). `persist`: `minWriteIntervalMs`. `sim`: `atSeconds`, `fromSeconds`, `spanSeconds`, `creditedSeconds`, `uncappedSeconds`, `flatAfterSeconds`. `ui`: `minMs`, `standaloneMs` |
| **not a duration** | 1 field | `sim.Ledger.atMs`, an instant, branded `EpochMillis`. The grep catches it because the unit convention works; see below |

**One quantity in thirty-seven.** That is the number that decides how far this RFC reaches, and it
is the reason the answer is a tiered rule rather than a kit-wide migration: `input` did not discover
a pattern the rest of the kit is missing, it discovered the treatment for **the only value in
Lattice that has an authority and is not read from it.**

Two entries deserve a note because they look like counter-examples and are not:

- **`sim`'s `atSeconds` / `creditedSeconds` are outputs**, not inputs. Nobody types them; they are
  read off a schedule. A tier is a question about who supplies a value, and nobody supplies these.
- **`sim.Ledger.atMs` is `EpochMillis`, and it is not a duration.** It is an instant, it is branded
  correctly, and `ledger.ts` says exactly why in one line: *"`core` brands `EpochMillis` precisely so
  that substitution is a compile error."* That is the mechanism working in the place it belongs, and
  it is the reason the mechanism looked available for durations.

---

## 6. The audit: how far the assumption travelled

The half of this task that was worth doing. I searched every `.md`, `.ts` and `.json` outside
`node_modules` for `Millis`, for `brand`, and for compile-error claims made about a duration.

**36 files mention `Millis`. Two of them assert that a duration brand exists. Zero packages depend
on it, and it was caught the first time anyone tried to build on it.**

| # | site | the claim | true? |
|---|---|---|---|
| 1 | `examples/_shared/README.md`, finding 1 | *"it may take the loop — or a `{ readonly stepMs: Millis }` structurally — and the literal becomes unconstructable"* | **false.** `Millis` is `number`, so `{ stepMs: 16 }` constructs fine. The first half of the same sentence is correct and is what shipped |
| 2 | `.lattice/tasks.json`, `K13` acceptance | *"take the loop, or `{ stepMs: Millis }` structurally — the branded type exists precisely so this substitution cannot compile"* | **false**, and it is site 1 with a stronger verb. This is mine |

That is the whole chain, and its shape is the finding: **one observation, one hop, one builder.**
The panel author wrote a finding that was three-quarters right; translating it into an acceptance
criterion made it wrong by adding a certainty the original did not have (*"structurally"* became
*"the branded type exists"*); the builder read the criterion, opened the two files it named, found
both claims false, and wrote the correction into `packages/input/src/step.ts` before writing any
code against it.

**Nothing was built on it.** The distance from a false premise to a refutation was one task, and
that is a fact about the process rather than luck: the criterion named the exact type and the exact
package, so checking it cost one `grep`. A criterion that had said "make the step type-safe" would
have been unfalsifiable and would still be open.

### The four documents that had it right, and why they did not stop it

Worth counting, because it bounds what more prose could have achieved:

| site | what it says |
|---|---|
| `packages/core/src/time.ts` | *"**Core does not export `Millis` or `Seconds`.** `loop` owns those two names for durations… Durations elsewhere stay plain `number` with the unit in the parameter name."* |
| `packages/loop/src/clock.ts` | *"A plain `number`, deliberately unbranded… this type **guards nothing** — it is documentation attached to a parameter."* |
| `docs/rfc/core.md` §7 | the home analysis that decided `core` owns `EpochMillis` and does not own `Millis` |
| `docs/rfc/input.md` §3 | specified `readonly stepMs: number`, honestly, with the warning in the doc comment |

So the truth was stated four times, twice in the source of the two packages involved, and the false
claim was written anyway — twice. **The prose was not the failure.** The failure is one line in
`.lattice/kit.json`:

```
"loop": { "exports": [ …, "ManualClock", "Millis", "Pump", …, "Seconds", … ] }
```

An agent reads the manifest first — `AGENTS.md` says so in its third line — and in the manifest
`Millis` is a public exported type of `loop`, alphabetized among `Clock`, `Loop` and `Scheduler`,
sitting one package away from `core`'s `EpochMillis` and `MonotonicMillis` in the identical
position. **Nothing in the machine-readable map distinguishes a type that guards from a type that is
a synonym for `number`**, and the doc comment that says so is two files deeper than anyone got. See
finding 1 in §11.

---

## 7. What is deliberately absent

This section is the one that stops the next agent adding it back.

- **No `Millis`, `Seconds` or `Duration` brand in `core`.** §3 is the argument: a brand separates
  kinds and durations have one kind, the mint cannot check the claim it makes, and no home on the
  DAG makes it reachable and unforgeable at the same time. If this is proposed again, the proposal
  must first name the *pair of values* the brand is separating. If it cannot, it is asking for
  validation and should ask for that instead.

- **No `Millis` alias in `core` either**, branded or not. `time.ts` already refused this and the
  refusal is right for a reason worth restating: a second alias for a name `loop` already exports is
  the exact drift that module exists to prevent, with `core` as the culprit. The kit would then have
  two `Millis`, structurally identical, mutually assignable, and no reader able to say which one a
  signature meant.

- **No `asMillis()` mint.** It would have to be exported by `core` to be reachable, would be
  callable on any literal, and its only effect would be to make a wrong step *look audited*. A
  validator whose check is `Number.isFinite` on a value where every finite number is legal is a cast
  wearing a function's clothes — and `core/src/guard.ts` already has `expectFinite` for the honest
  version of that job.

- **`FixedStep` does not move to `core`.** It is tempting: one interface, two consumers, no
  duplication. It is refused because a shared nominal type would make `loop` responsible for
  satisfying a shape `core` defines, would put a concept only two packages have into the package
  every package imports, and would buy nothing — **the structural declaration already costs zero
  coupling**, which is the entire reason it works across a sibling edge. Revisit only if a *third*
  consumer appears and the two existing declarations have drifted; today there is exactly one
  declaration, in `input`, and `loop` satisfies it without knowing `input` exists.

- **No cross-check on tier-3 durations.** No `longPressSeconds` beside `longPressMs`. §4 says why:
  redundancy without an independent source is two chances to make the same typo.

- **No runtime unit inference.** Nothing anywhere in this kit may look at `0.016` and decide it
  "must be seconds". `time.ts` already refused the same idea for instants and gave the reason — the
  heuristic rejects the legal values every test starts at. A duration of `0.016` ms is legal, a
  duration of `16667` seconds is legal, and a rule that guesses is a rule that fails on the case
  nobody anticipated.

- **No lint rule for the tiers.** One narrow piece of this *is* lintable and is proposed in §8.5 —
  that a duration parameter's name ends in its unit. The tier itself is not: a linter cannot tell
  whether an authority exists for a value, and one that guessed would train agents to add pairs to
  values that have nothing to check against.

---

## 8. Invariants a reviewer can test

Phrased so a failing case is obvious.

1. **`core` exports no branded duration.** Its two brands are instants and are named as such.
   *Failing case:* any `export type` in `packages/core/src` whose brand symbol names a length of
   time rather than a point in it.

2. **A duration with an authority is never typed as a number.** For every duration parameter, either
   a second component of the program computes the correct value — in which case the parameter takes
   that component or its pair — or it does not, in which case it is a bare number with the unit in
   its name. *Failing case:* a package that publishes `stepMs` and a sibling that accepts
   `stepMs: number` beside it. That is the defect this RFC was written for, and today the count is
   zero.

3. **The pair's two views are bit-compatible with the owner's.** `fixedStep(hz).stepMs` equals
   `createLoop({ hz }).stepMs` exactly, for every legal `hz`. *Failing case:* `fixedStep` computing
   `1000 / hz`, which differs in the twelfth decimal and produces a `persist` replay refusal rather
   than a wrong gesture — a failure that appears in a different package, months later.

4. **A hand-typed pair is refused by name.** `{ stepMs: 16, stepSeconds: 0.016667 }` throws, and the
   message contains both numbers and the remedy. *Failing case:* a tolerance loose enough to admit
   it. The band is four orders of magnitude above float noise and ten below the mistake, and there
   is no real pair in between.

5. **Every duration parameter's name ends in its unit.** `*Ms`, `*Seconds`, no exceptions, including
   locals that are handed straight to one. *Failing case:* `after(3000, …)` on a callback measured
   in seconds — fifty minutes, silently, and the only thing that ever catches it is the name.
   **This is the one part of this RFC worth linting**, and it is a regex.

---

## 9. Traps

- **"A brand would have caught this."** It would not have, and this is the misconception the whole
  document exists to remove. The mistake was `16` where `16.667` was correct — a right-kind,
  wrong-value error. Every brand in TypeScript is erased at runtime and checks a *kind*. Before
  reaching for one, say out loud which two values it is keeping apart; if the answer is "a good one
  and a bad one" rather than "an X and a Y", the tool is wrong.

- **A brand in a leaf package is a brand nobody can use.** `Millis` cannot help `input`, `audio`,
  `ui` or `persist` however it is defined, because the edge does not exist. **Where a guard lives
  decides who it can protect**, and that question is answered by the DAG before it is answered by
  the type system. `core/src/time.ts` §"three layer-1 siblings naming the same concept have no
  common home below core" is the worked version of this and it is the reasoning to copy.

- **The second view must be derived, not restated.** A pair whose second field is computed from the
  first agrees perfectly and detects nothing. `FixedStep` works because both fields are roundings of
  one integer microsecond count, so a hand-typed pair is inconsistent to a degree no real pair can
  reach. An author copying this pattern must be able to say *what independent computation produces
  the second number*; if the answer is "the first one, divided", there is no check.

- **An exported type alias is a claim, and the manifest is where it is read.** `type Millis = number`
  has a doc comment saying it guards nothing and a **name** saying it does. Names outrank doc
  comments, machine-readable manifests outrank both, and `.lattice/kit.json` lists `Millis` beside
  `Loop` and `Scheduler` with nothing to mark the difference. That is how this assumption travelled;
  see §11 finding 1.

- **An acceptance criterion that names a type is a claim about the code**, and it is read as one. A
  criterion is a contract a builder is entitled to rely on, and *"the branded type exists precisely
  so this substitution cannot compile"* is not a goal — it is an assertion of fact, in a document
  whose whole authority is that it was written by someone who checked. The specificity is what made
  it cheap to falsify, which is the argument for keeping criteria specific; but a criterion asserting
  a type exists should be written only after the `grep` that found it.

- **Widening is not a leak.** `epoch + 1000` widens to `number`, and `stepMs * ticks` is a plain
  number too. That is correct in both cases and `time.ts` calls it a feature: `epochA - epochB` is a
  duration, not an instant, and losing the brand is the type saying so. Do not chase the brand back
  through arithmetic; re-brand at boundaries only.

---

## 10. What should change in `AGENTS.md`

One sentence, in **House style**, beside the `readonly` paragraph — which is where the kit already
warns that a type modifier can promise more than it delivers, and this is the same failure with a
different modifier. The orchestrator owns that file; this is the proposed text.

> **A branded type separates two *kinds* of value; it never checks a value.** `EpochMillis` and
> `MonotonicMillis` are branded because both exist in a running game and are mutually assignable, so
> the substitution is a compile error. A duration has no second kind — there is only a wrong number
> of milliseconds — so the kit has no duration brand and will not be getting one. Where a duration
> has exactly one correct value that something else in the program already knows, **take that thing,
> not the number**: `createInput({ step: loop })`, never `{ stepMs: 16.667 }`. Where the DAG forbids
> importing its type, declare the shape structurally with a second *derived* view of the same
> quantity, so a hand-typed value is inconsistent with itself —
> `packages/input/src/step.ts` is the reference implementation. Everywhere else a duration is a plain
> `number` **whose parameter name ends in its unit**, and that convention is the only defense there
> is. `docs/rfc/durations.md` has the reasoning.

And a second, smaller change worth considering for the same file, because it is the mechanism that
actually failed here rather than the one everybody looked at: **`.lattice/kit.json`'s `exports` lists
are read before any source file, and they flatten every type to a name.** If a package exports a type
alias that guards nothing, the manifest is the one place that fact has to be visible. Finding 1 below
is the cheap version of that; a `"synonyms"` key would be the thorough one, and I do not think it
earns its complexity for one entry.

---

## 11. Findings routed elsewhere

Not this RFC's paths. Each is small and each is a clause in an existing task.

| # | change | owner | note |
|---|---|---|---|
| 1 | **`loop`: stop exporting `Millis` and `Seconds`.** Inline `number` at the 36 type positions that use them and delete both aliases from `src/clock.ts`, `src/index.ts` and `.lattice/kit.json` | `loop` | **the actual cause.** Every use site's field name already ends in `Ms` or `Seconds`, so the aliases add no information at any call site — and in the manifest they add a false one. `clock.ts`'s unit-boundary paragraph stays; it is the part that was doing the work |
| 2 | **`.lattice/tasks.json`: correct `K13`'s second acceptance criterion in place.** It is `done`, so it stays in the queue as a written claim that a branded duration exists | orchestrator | a false criterion in a completed task is read by every agent who later greps the queue for prior art. Suggested replacement: *"take the loop structurally — `{ stepMs, stepSeconds }`, cross-checked, since no brand can cross a sibling edge"* |
| 3 | **`examples/_shared/README.md`: correct finding 1's second half.** The `Millis` clause is false; the loop clause is what shipped | `_shared` | one clause. The finding itself was right and is why `step: FixedStep` exists |
| 4 | **`docs/rfc/input.md` §3 is stale**: it specifies `readonly stepMs: number` and the package ships `readonly step: FixedStep` | architect (mine, next cycle) | the RFC was honest when written; the package is now ahead of it. §3.8's `InputLog.stepMs: number` is still correct — a log carries the number, not the pair |
| 5 | **`input`: consider `FixedStep` in the package README's compatibility section** | `input` | `version`/`stepMs`/`profile` are documented as read off a fresh log; the pair is not mentioned there and a reader assembling a headless replay will look for it |
| 6 | **A lint rule for invariant 8.5** — every parameter or field whose type is a duration has a name ending in `Ms` or `Seconds` | `tools/lint.mjs` | the one lintable piece. Cheap, catches the `after(3000)` class, and needs no knowledge of tiers |
