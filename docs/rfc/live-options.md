# Live options — data per call, or closed at construction?

**Task `K15`. Owner: lattice-architect. Status: decided.**

Raised by the gallery control panel, which is the first thing in this repository to try to move
the kit's parameters rather than read them.

---

## 1. The one sentence

> **Every option is readable back off the thing it configured; an option is also *settable* unless
> something downstream has a correctness claim that it did not change.**

Two claims, deliberately unequal.

**The first is a rule, it has no exceptions, and it belongs in `AGENTS.md`.** A getter over state
the object already holds costs three lines, has no policy attached, cannot break an invariant, and
cannot be argued against on grounds of cost, determinism or hot-path discipline. Nothing in this
kit has a reason to withhold one.

**The second is a judgement, it has exactly two exceptions, and the test for them is in §4.** It is
the harder sell and it should be, because the exceptions are real and one of them is the
constitution's headline claim.

Leading with the reader is not a softening of the answer. It is where the evidence points, and the
argument is about the *kind* of damage rather than the count:

> **A missing setter produces a rebuild. A missing getter produces a shadow copy.** The rebuild is
> visible, ugly and correct — an author sees it and files a finding, which is exactly what happened.
> The shadow copy is correct on the day it is written and drifts afterward with no error and no
> failing test. `Boot.cameraPolicy` was one `setBounds` away from describing a camera it disagreed
> with, permanently.

Of the gallery panel's three rebuild paths, one — the camera's — closed on getters alone, and the
other two needed setters as well. So this is not a claim that readback fixes most of the problem.
It is a claim that readback fixes the half that fails *quietly*, costs nothing, and has nobody
arguing against it.

**Adopt the reader rule kit-wide today; argue the setters one at a time on their merits.** §5
argues them, and after the two exceptions are removed there is very little left to argue about —
which is the point of §3.

---

## 2. The observation, and the correction it needs

The report from `examples/_shared` reads:

> `sim`'s parameters are data passed per call, so all three of its knobs are live and none of them
> needed a rebuild. Every other package's parameters are closed over at construction. **It is worth
> noticing which shape made that possible.**

Both halves of the observation are true and the conclusion drawn from it is wrong. `sim` did not
choose a better options shape. **`sim` has no options at all**, and that is checkable in one
command:

```
$ grep -rn "export interface .*\(Options\|Opts\|Config\)" packages/sim/src
$                                   # no output. sim is the only package with none
```

`CostCurve`, `OfflineCurve` and `Milestones` are not configuration. They are the caller's **domain
model**, passed the way `elapsedSeconds` is passed, and `sim` retains not one byte of them between
calls. Nothing in `sim` owns a resource, so nothing in `sim` has a lifetime, so nothing in `sim`
ever had a configuration question to answer.

`draw`, `iso`, `input` and `audio` own a canvas, a buffer, a pointer capture and an
`AudioContext`. **The whole reason each of them is an object is that something is retained**, and a
retained thing cannot take its policy per call without the caller re-supplying it sixty times a
second. "Be like `sim`" is not an option available to them. The reachable version of it — the one
`draw.light` actually reached today — is a live setter.

So the asymmetry the panel found is real, but it is not `sim` versus the rest. It is that
**four different things in this kit are all spelled `SomethingOptions`**, and no package
distinguished them:

| kind | it is | examples | correct shape |
|---|---|---|---|
| **argument** | one call's parameters | `BoxOpts`, `PlayOptions`, `FrameOpts`, `PathOptions` | passed per call. There was never a question here |
| **domain data** | the caller's model, on loan | `CostCurve`, `OfflineCurve`, `Milestones` | passed per call, retained by nobody |
| **policy** | what the subsystem is *told to do* | `LightFieldOpts`, `CameraOptions` (minus `zoom`), `maxVoices`, `maxPan`, `GestureProfile` | **live** — a getter and a validated setter |
| **identity** | what the subsystem *is* | `LoopOptions.hz`, `AudioOptions.context`, `TileGridOptions.bits`, `StoreOptions` head | **baked** — and readable, and the setter is `new` |

The kit's mistake was never "it baked things". It is that **it never separated policy from
identity, so it baked both** — and then, in `draw`, baked two members of one interface and not the
third, which is what an accident looks like from the outside.

---

## 3. The decision

**Live is the kit-wide default, stated as a rule with two named exceptions and a test — not as a
per-package judgement.**

Per-package judgement is what the kit already has, and here is what it produced: `falloff` per call
on `add`, `scale` and `bloom` frozen at construction, in one interface, with no principle anywhere
in the package separating them. That is not nine considered answers. It is nine independent authors
each reading their option where it was convenient and never being asked the question. **An
asymmetry nobody can defend is not a judgement; it is an absence of one**, and a rule is how you
tell the difference next time.

But "live by default" is exactly as unexamined as "bake everything" if it ships without the two
exceptions, because both of them are real and one of them is the constitution's headline claim.

### Cost was never why any of this was baked, and it must not become the excuse

The camera fix is the proof and it is worth stating as a general expectation rather than as one
package's anecdote. `minZoom`, `maxZoom` and `keepVisible` are three numbers read inside a clamp.
Making them settable cost a store and one re-clamp — **the same work `setBounds` was already
doing in the same file.** No allocation to redo, no buffer to resize, no handle to invalidate, no
consumer to notify. They were not closed over after weighing anything. **They were closed over
because the constructor was the only place anyone had thought to put them.**

Expect that to be the common case, and check each remaining knob against that specific question:
*what does changing this value actually cost?* The audit in §5 is that check, and the answer comes
back "nothing" for most of the kit — `maxVoices` is an integer in a comparison, `maxPan` is a
clamp bound, `onDiagnostic` is a function reference, `budgetMs` is a threshold.

Which is why **"it would be some work to re-apply" is not on the list of reasons in §4.** It is not
an oversight that cost appears there only as Q3, and only as a reason to change *what* you bake
rather than *whether*. A rule whose escape hatch is the author's estimate of difficulty is a rule
that bakes whatever its author found inconvenient — which is precisely the state this RFC is
correcting. **The only admissible reasons to refuse a setter are correctness reasons.**

---

## 4. The test a package author applies

There is one question underneath all of this, and an author who holds onto it can re-derive the
rest:

> ### Does anything downstream have a **correctness** claim that this value did not change?
>
> Not "would it be work to re-apply". Not "is it read often". **Does something else in the system
> depend, for its correctness, on this number having been the same the whole time?**

It takes three forms, because the three have three different remedies. Ask them in order; **the
first "yes" decides it, only the first two can say "baked", and the third can never say it.**

### Q1 — Identity. *Would changing this value make it a different object?*

Ask it concretely, never philosophically: **does anything the object has already allocated,
already handed out, or already written down depend on this value?**

| value | what depends on it | verdict |
|---|---|---|
| `TileGridOptions.bits` | the typed array that already exists | identity |
| `ChunkGridOptions.chunk` | every chunk already allocated and every key already packed | identity |
| `AudioOptions.context` | the device. The engine *is* that context | identity |
| `LoopOptions.hz` | every `dt` already handed to `update`, and `stepMs` | identity |
| `StoreOptions` head / version | the schema of every record already written | identity |

Baked. Not "for now" — **structurally**, and the honest signature for changing it is `new`, not
`setBits`. A setter here is a lie: it would either throw for every non-trivial input or silently
corrupt the thing it was called on.

**Baked still means readable.** `iso.TileGrid` gets this right today — `w`, `h`, `originGx` and
`data` are all public readonly fields, and the option that *is not* readable (`bits`, via `data`'s
type) is readable through the store it produced.

### Q2 — Record. *Would a recorded artifact become **invalid**, not merely different, if this value changed between the recording and the reading?*

This is the determinism question and it is the sharpest of the three, so state it precisely,
because "the save contains this number" is **not** what it asks.

> **Content is not a precondition.** `audio`'s mixer state is written into a save by
> `snapshot()`/`restore()` and is nonetheless correctly live: a save carrying a different master
> gain is a *different save*, not a *broken* one. `loop`'s `stepMs` is a precondition: a log
> recorded at 16.667 ms and replayed at 20 ms is refused by name, because replaying it anyway
> produces a divergence report that is confidently wrong — which `docs/SEAMS.md` already ranks as
> worse than one that refuses.

`hz` and `stepMs` are the precedent the brief names, and they are a precedent rather than an
exception: they are *the worked example of Q2*, and the reason they are baked is written down in
`loop.ts` in one sentence — *"it is a migration, not a tuning pass."*

The kit has exactly one other Q2 value, and it is the interesting one:

**`input`'s compatibility triple is `version`, `stepMs`, `profile`.** `record.ts` says so in its
header, in as many words:

> *a session recorded under a tap threshold of 8 px and replayed at 12 px turns one pointer stream
> into a different sequence of actions. A migrated input log is a log that no longer replays.*

So `GestureProfile` is a Q2 value. **And Q2 does not say "bake it forever" — it says "bake it for
the duration of the recording."** That is a much smaller claim and it is the whole answer to the
`input` case:

> **`input.setProfile(overrides)` should exist, and should throw while a recording is in flight,
> naming the recording.**

That refusal is not a new pattern to invent. It is four lines from where it belongs, in the same
file — `system.ts` already throws a named `RangeError` when a second recorder starts on a system
that is already recording, and already tracks `recording !== undefined` to do it. A profile change
mid-recording is the same defect with the same detection and deserves the same sentence.

The general form, worth stating once so nobody re-derives it per package:

> **An option that can change mid-session is an option that can change mid-replay.** There are only
> two honest treatments. Either the option is *upstream* of the log — it decides what the log says
> — in which case moving it invalidates the log and the setter must refuse while one is open; or
> the option is *downstream* — it decides what a frame looks like and nothing hashed or persisted
> reads it — in which case it is free. `bloom` is downstream. `tapSlopPx` is upstream. **Nothing in
> the kit is allowed to be neither**, and an author who cannot say which has found the real
> question rather than a hard one.

There is a third treatment — record the option change as a tick-stamped entry in the log, so the
option becomes part of the input stream. It is strictly more powerful and it is **deliberately
absent**; see §6.

**When a Q2 value has to move anyway, add the dial beside it — do not unbake it.** `loop` already
worked this out and it is the pattern to copy: `hz` is immovable, and `Loop.setSpeed(multiplier)`
is the only live knob in the package. Speed changes how fast the world runs without touching
`stepMs`, so a recorded log stays valid across it. **The question "how do I let a player change
this?" almost always has an answer that is not "make the constant settable"**, and finding it is
cheaper than defending a migration.

### Q3 — Cost. *Is it read on the hot path?*

**This question can slow a setter down. It can never justify baking an option**, and the belief
that it can is the misconception this RFC exists to remove.

The performance argument for construction-time options is "validate once, never re-check", and it
is a real argument — against the *wrong* thing. The kit has already written down where validation
belongs, in `core/src/guard.ts`'s own header:

> *These run at construction and **at API entry points**. They do not run per frame or per entity.*

A setter **is** an API entry point. That sentence already licenses this whole RFC; nothing about it
says the entry point has to be a constructor. A live option does not mean an unvalidated bag is
re-read per frame. It means:

- the bag is validated and copied into private fields at construction, **and again in the setter**,
  by the same validator;
- the hot path reads the private fields and knows nothing about the bag;
- the setter runs a handful of times a session, from code holding no pointer.

**The hot path is byte-identical to the baked version.** `draw`'s `light.ts` is the reference
implementation and it took one function to get there:

```ts
// packages/draw/src/light.ts — `adopt` is the whole trick.
// Validates the merged result before assigning anything, "so a rejected `configure`
// leaves the field exactly as it was rather than half-moved", and is called from
// `createLightField` and from `configure` alike — the same three errors, same words,
// whichever entrance a bad number arrives through.
function adopt(next: LightFieldOpts | undefined, fn: string): void { … }
```

Where the value has a *derived* form that is genuinely expensive — a buffer size, a lookup table, a
pathfinder's index width — **bake the derivation, not the option.** The setter re-derives, and
`light.ts` also shows where: a new `scale` resizes on the next `begin` rather than inside the
setter, because half a frame's pools at one resolution and half at another is a worse bug than a
frame of latency.

That is the epoch rule, and it generalizes past `draw`:

> **A live setter takes effect between frames, never inside one.** An option read once per frame
> may be moved at any time; an option read *during* a frame's accumulation moves at the next frame
> boundary. Say which in the doc comment, because the caller cannot tell from the signature.

### The fourth form, for completeness: the value is not an option at all

Sometimes the correctness claim is not about the value's *stability* but about the **path** that
changes it. `camera.zoom` is the case, and its own doc comment has the sharpest statement of it in
the kit:

> *`zoomAt` exists to keep the world point under the pointer pinned; if any path can write
> `camera.zoom = 2` it skips the anchoring, and no test can catch what it cannot observe — the
> invariant holds in the suite and breaks in the game.*

The invariant being protected is **not** "zoom is immutable". It is *"nothing changes zoom without
naming what stays put."* So the remedy is neither a setter nor a baked field: **readable, and moved
only through the operation that carries the decision.** That is a third answer, it is why `zoom` is
not an exception to this RFC, and it is the answer an author reaches for when the honest sentence
is "you may change this, but not without telling me *X*".

Test for it directly: *if I added a plain setter, what question would the caller stop being asked?*
If there is such a question, name it in the method instead. If there is not, it is a policy and it
gets a setter.

### If all three are "no" — live

A getter of the same name, and a setter validated in the same words as construction.

---

## 5. The kit, audited against the test

Every options field currently reachable from a package's `index.ts`, tiered. **`✓` is already
correct today**; `→` is the change the test asks for.

| package | value | Q | today | verdict |
|---|---|---|---|---|
| `loop` | `hz` | **Q2** | baked, readable as `stepMs`, refusal owned by `persist` | ✓ correct, and it is the worked example |
| `loop` | `maxCatchUpMs`, `budgetMs` | — | baked | → live. Neither is recorded and neither is identity; a frame-budget slider is a legitimate thing a game wants and cannot have |
| `persist` | store head, version | **Q1** | baked | ✓ |
| `persist` | `AutosaveOptions` interval | — | baked | → live. An autosave cadence is policy by definition |
| `iso` | `TileGridOptions.bits`, `origin*`, `ChunkGridOptions.chunk` | **Q1** | baked, mostly readable | ✓ (see `docs/rfc/chunkgrid.md` for whether `ChunkGrid` ships at all) |
| `iso` | `camera.minZoom` / `maxZoom` / `keepVisible` / `bounds` | — | **fixed today** — getters plus `setZoomLimits`, `setKeepVisible`, `setBounds` | ✓ and it is the second reference implementation. See §7 |
| `iso` | `camera.zoom` | — | getter, no setter, moves only via `zoomAt` | ✓ — **and it is not a baked option.** It is *state*; see the trap in §8 |
| `iso` | `PathOptions` | — | per call | ✓ argument, not configuration |
| `draw` | `LightFieldOpts.scale` / `falloff` / `bloom` | **Q3** on `scale` | **half-fixed today** — `configure()`, one validator, epoch rule stated, and **no getters at all** | the reference implementation for the setter; **a rule-11 violation for the readback.** See below |
| `core` | `PoolOptions.max` | — | baked, `size`/`free` readable, `max` not | → readable. `initial` is Q1 (the pool is already that size); `max` is policy |
| `draw` | `Canvas2dOpts.pixelRatio` / `maxPixelRatio` | **Q3** | baked; `surface.pixelRatio` readable, `resize` takes a ratio that **walks past the clamp** | → live, and the setter is the fix for the third silent trap in `examples/_shared/README.md` |
| `input` | `stepMs` | **Q1 + Q2** | baked, readable, takes a bare `number` | ✓ baked correctly — but see `K13`; the *type* is wrong, not the lifetime |
| `input` | `GestureProfile` (all 13 scalars + `tapSlopPx`) | **Q2** | readable, **not settable at all** | → `setProfile(overrides)`, refusing while a recording is open, in the words `system.ts` already uses for a double recorder |
| `input` | `control`, `focus`, `onDiagnostic`, `actions` | — | baked | → live. None is recorded, none is identity, and `actions` in particular forces a full dispose-and-re-register today |
| `audio` | `context` | **Q1** | baked | ✓ |
| `audio` | `maxVoices` | — | **baked, and it is the dangerous one** | → live. See §6 |
| `audio` | `maxPan` | — | baked | → live |
| `audio` | mixer gains | — | already live, and persisted | ✓ — and the proof that "recorded" alone does not mean "bake it" |
| `sim` | everything | — | domain data, per call | ✓ — and **not** the model for anyone else |
| `ui` | `PanelOptions`, `ToastOptions`, `BrandOptions`, … | — | baked | → out of scope here, but the same test applies and `ui` is the package with nine options interfaces and no consumer yet. Better to answer this before it has one |

### The kit currently contains exactly two write-only configurations, and one of them is a day old

`LightField` can be `configure`d and cannot be read: its surface is `active`, `count`, `begin`,
`configure`, `add`, `addScreen`, `composite`, `resize`, `dispose` — no `scale`, no `bloom`, no
`falloff`. `Audio`'s `maxVoices` and `maxPan` can be neither read nor set. Everything else in the
kit that is settable is also readable.

**That the freshest, most carefully argued fix in the kit still shipped half the pair is the
strongest evidence in this document that readback needs to be a rule.** `light.ts`'s author
reasoned correctly about mutability, wrote three paragraphs defending it, added a shared validator
and an epoch rule — and did not add three getters, because nothing asked. A panel wanting to render
the current `bloom` next to its slider must still keep a shadow copy, which is the *identical*
defect the same panel just had with the camera and for the identical reason.

Mutability is the interesting half and it is the half that gets thought about. Readback is the
boring half, it costs three lines, and it is the half that gets skipped — which is exactly the
profile of something that belongs in the constitution rather than in a reviewer's judgement.

### `audio.maxVoices` is the case that makes this a rule rather than a preference

It is the only value in the kit where the current shape has a **hard, external, irreversible** cost.

`AudioOptions.maxVoices` is one integer, read by `createPlayPolicy` and consulted once per `play()`
in a comparison. It is not identity: nothing is allocated from it. It is not recorded: no log or
save carries it. It is not hot: `play()` is a handful of calls a second. Under every question in
§4 it is *live*, and it is baked.

The consequence is written down in `audio`'s own doc comment, and the panel found it from the other
side:

> *browsers cap live contexts per document — six, historically — and a test file that creates one
> per case exhausts that cap and fails in a way that looks like a broken assertion.*

So the rebuild-to-reconfigure story for `audio` is: `dispose()` closes the `AudioContext`, a
document gets about six, and **a live voice-ceiling slider therefore permanently silences the
page** in under a second of dragging. `examples/_shared` ships that control on `commit: 'change'`
for exactly this reason, and calls it what it is: *"a control that can permanently silence a
page."*

**This is what "rebuild to reconfigure" costs when the resource is not renewable.** It is not a
performance note. It is a footgun with a hard limit behind it, on the one knob whose *wrong end is
the whole point of exposing it* — `GALLERY.md` requires the ceiling slider precisely so a visitor
can push it to two and hear a burst choke.

One integer, one setter, no allocation. There is no argument on the other side.

---

## 6. What is deliberately absent

This section is the one that stops the next agent adding it back.

- **No `configure()` on everything.** The test's default is a *typed setter per policy value or per
  coherent group*, not a universal bag-swallowing method. `draw`'s `configure(LightFieldOpts)` is
  right because its three fields are one coherent quality decision validated together. `iso`'s
  `setZoomLimits(min, max)` is right because min and max must be checked against each other in one
  statement. A `camera.configure({ … })` that accepted any subset would have to re-derive the whole
  clamp on every call and would let a caller move `bounds` and `keepVisible` in an order that is
  briefly inconsistent. **Group by what must be validated together, never by what happens to share
  an interface.**

- **No observable, no subscription, no `onOptionChanged`.** A panel that moves an option already
  knows it moved it. A subsystem that needs to react re-derives inside its own setter, which is the
  only place that knows what re-deriving means. An event bus for configuration is how two clocks
  get into a game, and `docs/SEAMS.md` already names that as the bug that overwrote a player's
  typed company name.

- **No option changes recorded into the input log.** The third treatment in Q2 — tick-stamping a
  profile change so a replay reproduces it — is strictly more powerful and is refused. It turns the
  compatibility triple into a triple plus a change list, makes every log's validity depend on
  replaying a *sequence* of profiles rather than matching one, and buys a capability nothing has
  asked for: **no exhibit, and no plausible game, retunes its tap slop mid-session.** The cheap
  refusal (`setProfile` throws while recording) costs one boolean and is already how `system.ts`
  refuses a double recorder. Revisit only if some artifact genuinely needs to record a session
  across a settings change — and note that saving the settings *outside* the log solves that case
  too.

- **No frame-rate knob, anywhere, ever.** `LoopOptions.hz` is Q1 *and* Q2 and its own doc comment
  says changing it is a migration. `examples/_shared` deliberately ships no frame-rate slider and
  says so; this RFC ratifies that. An exhibit that adds one has broken every log the kit has
  written.

- **No per-call options bags on the hot path**, and no migration of `draw` or `iso` toward `sim`'s
  shape. `offlineCredit` revalidates its whole curve on every call — three `expectFinite`s and
  three comparisons — and that is correct because it runs once per return. The same code inside
  `light.add` or `drawSprite` would be `expectFinite` per pool per frame, against non-negotiable 7.
  **`sim`'s shape is right for `sim` and does not generalize**, and §2 says why in one line: `sim`
  retains nothing, and every other package exists because something is retained.

- **No `readonly` as the mechanism.** House style already warns that TypeScript ignores property
  `readonly` when checking assignability, so a `readonly` field on an options interface prevents
  nothing at runtime and is documentation. The barrier that matters is *not exposing a settable
  reference to internal state* — which is why `camera` exports an interface and a factory rather
  than a class with public fields, and why that shape should be copied rather than the modifier.

---

## 6b. The holes in these rules, stated rather than left to be discovered

`iso`'s author set the standard this section follows. `setZoomLimits(2, 2)` **does** force the zoom
with no pointer anywhere near it — the exact thing the no-setter rule on `zoom` exists to prevent —
and they wrote that down in `packages/iso/README.md` beside the rule instead of hoping nobody
tried it. The no-setter rule makes the *common* mistake unrepresentable; it was never a security
boundary. **Saying so is cheaper than letting someone find the hole and conclude the rule was
sloppy**, because the second thing they conclude is that the rest of the rules are decorative too.

So, the holes in what this RFC proposes:

- **A getter is not a promise that the value is in force yet.** `LightField.configure({ scale })`
  takes effect on the *next* `begin`, so a `scale` getter added per §10 will report the new number
  while the buffers are still at the old one. That is the right trade — the alternative is
  reallocating inside a frame — but it means the readback rule guarantees *"what you set"*, not
  *"what is currently rendering"*. Where those differ, the doc comment says so. Nothing in the kit
  needs the second reading; if something ever does, it needs a differently named member, not a
  redefinition of this one.

- **Refusing `setProfile` during a recording protects the log, and only from the values the log
  declares.** The compatibility triple is `version`, `stepMs`, `profile`. **`actions` is not in
  it** — and the log stores `RawSample`s, so actions are re-derived at replay from whatever map is
  in force then. Making `actions` live (finding 3) therefore opens a hole the profile refusal does
  not cover: rebind `KeyB` mid-recording and the replay does something else, silently, with a
  triple that matches. **The finding as routed is incomplete and says so** — `setActions` must
  refuse while a recording is open on the same grounds, or `actions` joins the triple. Refusal is
  the cheaper answer and matches §6's rejection of change-lists in the log.

- **"Readable" has a loophole worth naming: a getter over a stale local.** The rule is satisfied
  syntactically by a getter that returns a field the setter forgot to update. Invariant 3 below is
  the guard, and it is why the setter must assign through the *same* private field the getter
  reads rather than keeping a copy of the options bag.

- **This RFC does not make the kit uniformly live, and should not be read as claiming it will.**
  After §5, `hz`, `stepMs`, `context`, `bits`, `chunk`, store heads and pool `initial` are still
  baked, and `zoom` still has no setter. That is six-ish values across nine packages, every one of
  them with a written correctness reason. **A rule with a short, enumerable exception list is the
  goal — not zero exceptions**, which would have required deleting the determinism guarantee to
  achieve.

### One point of disagreement, recorded

The framing this RFC was handed proposes: *an option a caller supplied must be readable, and an
option that is **cheap to change** must be settable.* The first half is adopted verbatim as rule 11.
**The second half is adopted in its conclusion and rejected in its criterion**, and the difference
matters more than it looks.

Cheapness is a fact about the implementation and it is assessed by the person who least wants to do
the work. "This would be expensive to make settable" is unfalsifiable in review, it is exactly the
sentence that produced `AudioOptions.maxVoices`, and admitting it as a reason re-opens the door
this RFC is closing. The same message's own fourth point says it better than its second:
*"'it would be a bit of work to re-apply' is not a correctness argument."* Agreed — so cost does not
appear in §4 as a reason to bake, only in Q3 as a reason to bake something *else*, and the
criterion for a setter is correctness alone.

The practical outcome is identical, because once the correctness exceptions are removed almost
nothing expensive remains. The stated criterion is what an author reaches for two years from now,
and it should be the one that cannot be gamed.

---

## 7. Invariants a reviewer can test

Phrased so a failing case is obvious.

1. **Readback is total.** For every `*Options` / `*Opts` interface field that survives its
   constructor, the constructed object exposes a getter of the same name, or a field from which the
   value is unambiguously recoverable. *Failing case:* `createCamera({ keepVisible: 0.2 })` and
   nothing on the result reads `0.2`. (This one is fixed today. It is listed because it is the
   invariant, not because it is open.)

2. **One validator, two entrances, same words.** For any value with both a constructor and a
   setter, a bad value produces the **identical error message** from both. *Failing case:*
   `createLightField(s, { bloom: 2 })` and `field.configure({ bloom: 2 })` throw different text.

3. **A rejected setter changes nothing.** Validate the merged result before assigning any of it.
   *Failing case:* `configure({ scale: 0.25, bloom: 2 })` throws and leaves `scale` at 0.25.

4. **A live setter never allocates on the hot path.** Move any live option to its extreme and back
   sixty times, then assert the per-frame allocation count is unchanged. *Failing case:* a setter
   that eagerly reallocates a buffer instead of marking it stale for the next `begin`.

5. **Q2 values refuse rather than migrate.** For every value in the compatibility triple, the
   setter throws while a recording is open, and the thrown message names the recording. *Failing
   case:* `input.record()` … `input.setProfile({ tapSlopPx: { touch: 20 } })` … `stop()` returns a
   log whose declared profile is not the profile half of it was recorded under. **This is the one
   invariant whose failure produces no error and no visible defect — only a replay that lands on
   the wrong pixel months later**, which is why it is written as a test and not as a warning.

6. **Q1 values have no setter at all.** Not a throwing setter — no such method. *Failing case:* a
   `setBits` that throws for every input, which is a signature promising something the object
   cannot do.

---

## 8. Traps

- **"State" is not "baked", and confusing them produces the wrong fix.** `camera.zoom` has no
  setter and *is not an exception to this RFC* — it is not policy at all. Its doc comment has the
  reason: `zoomAt` exists to keep the world point under the pointer pinned, and any path that can
  write `camera.zoom = 2` skips the anchoring, so *"the invariant holds in the suite and breaks in
  the game."* The rule for state is a third thing: **readable, moved only through the operation
  that carries the invariant.** An author applying "live by default" mechanically will add
  `setZoom` and unpin the pointer. `camera.ts`'s two-row table — *position* versus *policy* — is
  the clearest statement of this line in the kit and is worth reading before writing any setter.

- **The failure of a baked option is silent on the package's side and loud on the caller's.** No
  test in `iso` failed because `keepVisible` could not be read back; `iso`'s suite was green
  throughout. The defect surfaced as *a shadow copy in a consumer three directories away, plus a
  camera and an input system rebuilt on every drag of a slider.* **Coverage cannot find this class
  of defect**, which is why it is a rule rather than a lint.

- **Two copies drift, and the second copy is usually invisible.** `Boot.cameraPolicy` existed
  because `Camera` had no getters. It was correct on the day it was written, and it was one
  `setBounds` away from disagreeing with the camera it described, forever, with no error.

- **The `dispose()`-to-reconfigure path is not uniformly cheap and the expensive ones are not
  labelled.** Rebuilding a `LightField` costs a buffer. Rebuilding an `InputSystem` costs every
  registered handler — which is the entire reason `Boot.onAction` exists as a re-registering
  wrapper. Rebuilding an `Audio` costs **one of about six `AudioContext`s the document will ever
  get, permanently.** An author who reasons "the caller can always rebuild" is assuming a
  uniformity the kit does not have.

- **Validating per call is not the same as being live**, and the panel's report conflates them
  because `sim` happens to do both. Live is a setter. Per-call is an argument. A package can be
  fully live with zero per-call validation, and that is the shape this RFC wants.

- **A live setter may have to move *state* to restore its invariant, and it must say so.**
  `camera.setZoomLimits` re-clamps the current zoom in the same statement, so raising `minZoom`
  above the current zoom moves the view. That is correct — the alternative is a camera whose
  position violates its own policy — and it is documented. An author adding a setter without asking
  "what does this invalidate?" ships the silent version of the same thing.

- **Clamp or throw is decided by who supplies the value, not by which entrance it arrives at.**
  The kit already splits this cleanly: author-derived numbers throw (`createAudio.maxVoices`,
  `createLoop.hz`, every `sim` curve, the camera limits), player-derived numbers clamp or are
  silently ignored (`Mixer.setGain`, `PlayOptions`, `Bed.set`, `MusicDeck.setIntensity`) — because
  a `NaN` reaching an `AudioParam` poisons that node for its lifetime and a settings slider must
  not be able to throw. **A new setter inherits its value's existing policy; it does not get to
  pick a softer one because it is a setter.** `maxVoices` is author-facing at both entrances and
  therefore throws at both, which is what keeps invariant 2 below true. If a value ever is
  author-facing at construction and player-facing at its setter, that is two values.

- **An option nobody can see is not configurable, whatever its type says.** `GALLERY.md`'s premise
  is that the kit's configurability *"lives in doc comments and RFC tables, and a visitor has no
  way to discover"* it. The panel is the instrument that makes it visible, so **an option the panel
  cannot move is, in practice, an option the kit does not have** — and every `commit: 'change'` in
  the panel is one of those, wearing a slider.

---

## 9. What should change in `AGENTS.md`

Two paragraphs. The orchestrator owns that file; this is the proposed text.

**Add to the ten non-negotiables as an eleventh** — it qualifies, because it is testable, it has no
defensible exception, and a change that breaks it should be reverted rather than debated:

> 11. **An option a caller supplied is a value they can read back.** Every field of an options bag
>     that survives its constructor gets a getter of the same name on the thing it configured.
>     "Baked" is a legitimate answer to *can I change this*; it is never an answer to *what did I
>     set it to*. A value a caller handed over and cannot read is a value they must store twice, and
>     two copies drift with no error when they do — which is how the gallery's control panel came to
>     rebuild a camera, and the input system bound to it, on every drag of a zoom slider.
>
>     **Whether it can also be *changed* is a judgement, and it has a test: `docs/rfc/live-options.md`.**
>     One question — *does anything downstream have a **correctness** claim that this value did not
>     change?* — in three forms, first "yes" wins. *Identity*: does anything already allocated,
>     handed out, or written down depend on it? Then it is baked and the setter is `new`. *Record*:
>     would a recorded artifact become invalid, not merely different, if it changed between
>     recording and reading? Then it is baked while a recording is open, and the setter refuses by
>     name. *Cost*: is it read on the hot path? Then bake what the option **derives**, never the
>     option. Otherwise it is live. **"It would be work to re-apply" is not on that list**, and is
>     not an answer.

**Adopt the eleventh on its own, without waiting for §10.** That is the point of splitting the two
claims: the readback half is a blanket rule that costs nothing to adopt kit-wide, breaks nothing,
and can land in `AGENTS.md` this cycle. The setters in §10 are then argued one package at a time on
their merits — a much easier sell than "live by default", and one that does not need to be won
before the rule is worth having. One of the panel's three rebuild paths closes on getters alone; the
other two still need their setters, and are §10's business rather than the constitution's.

**And one sentence into "House style"**, beside the `readonly` paragraph it belongs with:

> An options interface is not automatically construction-time. Say which of the four kinds each
> field is — **argument**, **domain data**, **policy** or **identity** — and the shape follows;
> `packages/draw/src/light.ts` and `packages/iso/src/camera.ts` are the two reference
> implementations.

### Why not a lint rule

The readback half is nearly lintable and worth attempting later — "every field of a `*Options`
interface has a same-named member on the factory's return type" catches most of it — but it cannot
see through `data`'s type standing in for `bits`, and it cannot tell a Q1 value from a Q2 one. A
lint that got either wrong would train agents to add hollow getters. **Ship it as a rule and a
review question now; lint the readback half once the kit is uniform enough that the exceptions are
enumerable.**

---

## 10. Findings routed elsewhere

Not this RFC's paths. Each is one clause in an existing task.

| # | change | owner | note |
|---|---|---|---|
| 1 | `audio`: `maxVoices` and `maxPan` become live — a getter and a setter on `Audio`, `createPlayPolicy` reading a field rather than a closure | `audio` | **the sharpest case in `K15`.** As it stands the panel's ceiling slider can permanently silence the page, and `GALLERY.md` requires that slider |
| 2 | `input`: `setProfile(overrides)`, throwing while a recording is open, in the words `system.ts:639` already uses | `input` (`K13` names it) | Q2, and the refusal is already written four lines away |
| 3 | `input`: `control`, `focus`, `onDiagnostic` and `actions` become live — **and `setActions` must refuse while a recording is open, for a reason `setProfile`'s refusal does not cover** | `input` | changing `actions` today costs a full dispose and re-register. But the log stores `RawSample`s and `actions` is **not** in the compatibility triple, so a mid-recording rebind silently changes what a replay does with a triple that still matches. See §6b |
| 4 | `draw`: `Canvas2dOpts.pixelRatio` / `maxPixelRatio` become live, and `resize` stops taking a ratio that walks past the clamp | `draw` | closes the third silent trap in `examples/_shared/README.md` |
| 4b | `draw`: **`LightField` gets `scale`, `falloff` and `bloom` getters.** Three lines, finishing yesterday's fix | `draw` | the write-only half. A panel showing the current bloom beside its slider still keeps a shadow copy today |
| 4c | `audio`: `maxPan` is not validated — `clamp(finite(x, 0.6), 0, 1)` silently coerces where every neighboring option throws | `audio` | found in passing; unrelated to liveness, same file |
| 4d | `core`: `PoolOptions.max` becomes readable | `core` | `size` and `free` are readable and the ceiling they are measured against is not |
| 5 | `loop`: `maxCatchUpMs` and `budgetMs` become live. `hz` explicitly does not | `loop` | and the doc comment should say *"`hz` is the exception, and here is the test"* rather than leaving it as a local fact |
| 6 | `persist`: autosave interval becomes live | `persist` | |
| 7 | `ui`: apply the test before `B9` finishes, while nothing consumes it | `ui` | nine options interfaces, no consumer yet. The cheapest moment this will ever be |
| 8 | `examples/_shared`: once 1–4 land, `commit: 'change'` should survive on **nothing**, and `Boot.setProfile` / `Boot.setLight` / `Boot.setCamera` should shrink to forwarding calls | `_shared` | this is the acceptance test for the whole RFC. If the panel still rebuilds anything, a case was missed |
