# LAMP ROAD — retired, and the coverage debt the scope cut left behind

> **Status: RETIRED at `K8`.** Superseded by `docs/GALLERY.md`, which is now the plan.
>
> This document specified a ten-minute game with offline accrual, oil presses, guttering lamps, a
> rockfall re-route and a shrine ending. **None of that exists and none of it is going to.** What
> shipped from it is `examples/demo` — *Lamplighter*, a ninety-second exhibit — and one row in the
> gallery table.
>
> **The document is kept, rather than deleted, for two reasons and only two.**
>
> 1. **The orphan ledger below**, which is the point of retiring it. The scope cut left a large
>    part of the kit with no consumer anywhere in the repo, and that list has to live somewhere a
>    person will find it.
> 2. **Appendix A**, the `D2` argument. It is the sole record of why `CatchUp.fromSeconds` and
>    `OfflineCurve.uncappedSeconds` are shaped the way they are. Delete it and the next auditor
>    finds an uncalled field and removes it, correctly, on the evidence available to them.
>
> Everything else the document said — the beat sheet, the capability matrix, the line budget, the
> ending, the ranked gaps — was answered, superseded or cut, and is gone. The line budget in
> particular was met and then made irrelevant: `examples/demo/src` is about 1,700 lines across
> nine files against a 345-line budget for a much larger game, because the exhibit spends its
> lines on art, which is what `GALLERY.md` says it should.

---

## What actually happened

`A10` designed a game. `B1`–`B8` built nine packages against its capability matrix. Then
`GALLERY.md` replaced one flagship game with ten to fifteen small exhibits, for reasons that were
right — *a kit is judged by range, not by depth*, and the first attempt had already reached 1,450
lines and a near-black opening frame.

The cut was correct. It also had a consequence nobody wrote down: **the capability matrix was the
only thing pulling on about a third of the kit, and when it went, that third stopped having a
caller.**

`examples/demo` imports seven of the nine packages. It uses no save, no offline accrual, no
schedule, no pathfinder beyond `pathSample`, one gesture, and one audio bed.

---

## The orphan ledger

This is the useful half of this document.

Nine packages reached their coverage floor against tests written by the same agents that wrote the
code. That is a real quality signal about *internal* consistency and it is worth nothing at all as
a signal about whether an API can be used by someone who did not design it. The list below is
what has **never been picked up by anyone with a different goal.**

### How to read it

Four grades, because they are not equivalent and lumping them together is how this gets hand-waved:

| grade | means | worth |
|---|---|---|
| **shipped** | a built exhibit calls it | the real thing |
| **contract** | `test/contracts/*` calls it — written above the packages, against a seam, by someone holding two packages at once | nearly the real thing |
| **doc** | it appears in a ```ts fence in `README.md` or `docs/GUIDE.md`, which `tools/check-docs.mjs` type-checks | proves the signature compiles. Proves nothing about behavior, ordering, or whether the shape is usable |
| **self** | its own `src/` and its own `test/` and nothing else. **The orphan.** | the coverage number, and only that |

Census taken across `examples/**`, `test/**`, `tools/**`, every `packages/*/src`, `README.md` and
`docs/**`, at cycle 2.

### `@lattice/persist` — the whole package, minus a seam and a doc

| surface | grade | which exhibit will exercise it |
|---|---|---|
| `createStore`, `Envelope`, `OpenResult`, `defaultChecksum`, `webStorage` / `browserStorage` | **doc** | **Migration** (`G12`) |
| `migrations`, `Recognize`, `MigrationStep`, `MigrationChain`, `ChainBuilder`, `Increment` — the v1→v2 chain | **doc** | **Migration** (`G12`). Its whole row is *"a v1 save opened by a v5 build, stepping the chain in front of you"* |
| `createRecorder`, `ReplayCompat` | **contract** — `test/contracts/replay-step.test.ts` | **Replay** (`G11`) |
| `createVerifier`, `ReplayVerdict`, `Divergence`, `Refusal`, `Digest`, `Checkpoint`, `ReplayLog` | **doc** / **self** | **Replay** (`G11`) |
| **quarantine** — `Rejected`, `FailureReason`, `ReadFailure`, `inspect` | **self** | ⚠️ **nothing.** `G12`'s row is the *happy* path: an old save that migrates. A save that is refused is a different demonstration and no row asks for it |
| **autosave** — `Autosave`, `AutosaveOptions`, `Schedule`, `scheduleFrom`, `SecondsTimeline`, `WriteSkip`, `WriteResult`, `Cancel` | **self** (`Schedule` is **doc**) | ❌ **nothing, structurally.** `GALLERY.md`: *"no endings, no meta progression"*. An exhibit a visitor spends ninety seconds in has nothing to autosave |
| **flush triggers** — `installFlushTriggers`, `FlushTargets`, `ListenerTarget` | **self** | ❌ **nothing.** Same reason: nothing to flush on `pagehide` |
| `elapsedSince` | **self** | ⚠️ **Idle** (`G10`) *should*, but its row says *"fourteen hours of offline in one frame"*, which a fabricated timestamp satisfies without going near a store |
| `StorageAdapter`, `StorageLike`, `Checksum`, `StoreOptions`, `StoreStatus`, `Store`, `Recorder`, `RecorderOptions`, `ReplayVerifier`, `VERSION` | **self** | follow their functions above |

**Sharpest single finding in the census:** `scheduleFrom` is argued for at length in
`packages/persist/src/index.ts`'s header, and `docs/GUIDE.md` **hand-rolls the conversion instead
of calling it.** The package's own showcase did not reach for the function the package's own
header says exists. That is not an orphan; that is a discoverability failure with a witness.

### `@lattice/sim` — `offline` and `schedule`, entire

| surface | grade | which exhibit will exercise it |
|---|---|---|
| `offlineCredit`, `offlineElapsed`, `maxOfflineCredit`, `offlineCreditRate`, `OfflineCurve` | **self** | **Idle** (`G10`) — its row names it explicitly, and `GALLERY.md`'s control-panel section names *"drag the offline exponent to 1.0 and watch a fourteen-hour absence pay out uncapped"*, which is the softcap branch. Covered, and covered well |
| `advanceOver`, `solveCrossingOver`, `Phase`, `Crossing` | **self** | ⚠️ **nothing as written.** `G10` is *"fourteen hours of offline in one frame"* — one span, one warp. `schedule` exists for an absence *partitioned into phases* (fourteen hours containing fourteen nights). No row asks for that |
| **`CatchUp.fromSeconds`** | **self** | ❌ **nothing.** See below |

**`CatchUp.fromSeconds` is the worst entry in this ledger** and deserves its own paragraph.

First, a correction the census turned up: it is **a required interface field, not a method** —
`packages/sim/src/schedule.ts:90`, `readonly fromSeconds: number`. It is exercised at roughly forty
sites inside `packages/sim/test/schedule.test.ts` and twice in `flow.bench.ts`, and constructed
**nowhere else in the repository**.

It was added days ago to close a specific exploit: a crossing discovered *inside* a warped
absence, where calling `advanceOver` again with a fresh `spanSeconds` restarts `W` at that instant
and the player is credited for K absences instead of one — and each restart is *cheaper*, so the
exploit climbs back in through the function written to close it. The mechanic that produced the
crossing was **a lamp guttering out mid-absence**, and the scope cut deleted oil, deleted lamps
going out, and deleted absence. The field survived; the reason for it did not.

It is therefore a correct, well-tested, well-argued answer to a question this repository no longer
asks. Appendix A is the question, kept so that whoever finds this field can decide with the
evidence rather than without it.

### `@lattice/loop` + `@lattice/input` + `@lattice/persist` — the replay story

The seam is deliberately structural: the three packages declare each other's shapes and import
nothing, which is right and which also means nothing links them but a caller.

| surface | grade | which exhibit |
|---|---|---|
| `loop.replay`, `ReplaySource` | **contract** — `test/contracts/replay-step.test.ts` | **Replay** (`G11`) |
| `ReplayOptions`, `ReplayResult` | **self** | **Replay** (`G11`) |
| `input.record`, `replayCursor` | **doc** | **Replay** (`G11`) |
| `createLog`, `input.replay`, `InputLog`, `LOG_VERSION`, `RawSample`, `InputRecording`, `ReplayCursor` | **self** | **Replay** (`G11`) |
| `Diagnostic`, `DiagnosticCode`, `DiagnosticSink` | **self** | ⚠️ **Replay** (`G11`) only if it shows a *refused* replay. A verifier that has never returned a refusal in anger is a verifier nobody has tested |

Covered on paper, and `G11` is carrying more weight than any other row in the gallery. It is the
sole planned consumer of three packages' worth of replay surface plus most of `persist`.

### `@lattice/iso`

| surface | grade | which exhibit |
|---|---|---|
| `FlowField` | **self** | **Wayfinding** (`G8`) — *"a flow field re-routing a moving crowd the instant the map changes"*. Exactly this, and it is the only row that needs it |
| `ChunkGrid`, `ChunkGridOptions` | **self** | ❌ **nothing.** Chunked storage exists for maps too large to hold densely. Every exhibit is a world framed to fill one viewport; `examples/demo` uses `TileGrid`. No planned exhibit has any reason to want chunks |
| `anchor` — `Anchor`, `anchorToScreen`, `anchorVisible`, `anchorPan` | **self** | ⚠️ **Builder** (`G9`) is the only plausible home, and it is not in `G9`'s row |

**`anchor` is worse than orphaned — it was needed and not found.** `examples/demo/src/main.ts`
hand-rolls a world-anchored screen marker for the lamp bubble's tap target:

```ts
gridToScreen(camera, t.gx + 0.34, t.gy + 0.66, t.base + 2.2 * 26, tap);
const dx = px - tap.x;
```

That is `anchorToScreen` with the offsets inlined, written by an author who had the module
available and did not know it existed. An unused export is a maybe. An export whose first user
reimplemented it is a naming or a documentation defect, and it is the same failure as
`scheduleFrom` above.

### `@lattice/draw`

| surface | grade | which exhibit |
|---|---|---|
| `createOffscreenSurface` | **shipped-ish** — `packages/ui/src/thumb.ts` imports it | ⚠️ no *exhibit*, but it has a real cross-package consumer. **Correction to the brief:** this one is not orphaned |
| `OffscreenSurface`, `OffscreenOpts`, `Canvas2dOpts` | **self** | follows the above |
| `createRecordingSurface`, `RecordingSurface`, `RecordingTarget`, `Op`, `OpName`, `ESTIMATED_ADVANCE_RATIO` | **doc** / **self** | ⚠️ **Replay** (`G11`) is its natural home — *"prove it: the same seed and log land on the same pixel"* is an op-stream comparison — but `G11`'s row does not say so |
| `drawGhost` | **self**, and **not mentioned in `packages/draw/README.md` either** | **Builder** (`G9`) — *"placement: footprints, a ghost, validity"*. Covered exactly, and `drawGhost` is currently the most invisible export in the kit |
| `spriteBounds` | **self** (prose only) | ⚠️ **Builder** (`G9`) or **Instrument** (`G13`), neither of which asks for it. `examples/demo` again hand-rolled its tap target rather than measuring one |
| `blit` | **not an orphan.** **Correction to the brief:** it is a method on `Surface`, not a package export, and `packages/draw/src/light.ts` calls it three times per composite — so *Lamplighter* runs it sixty times a second | — |

`packages/draw/src/index.ts` justifies keeping `record.ts` in `src/` rather than `test/` on the
grounds that **"`ui` wants it for layout measurement without a canvas."** That is not true today:
`packages/ui/src/thumb.ts` uses `createOffscreenSurface`, and nothing in `ui` references the
recording surface at all. A comment asserting a consumer that does not exist is how an orphan
survives an audit.

### `@lattice/input` — the gestures

The whole gesture *type* surface is `self`, which is structural rather than damning: exhibits
reach gestures through string literals (`actions: { touch: ['tap'] }`), not through the types. The
question that matters is which gestures anything actually asks for.

| gesture / knob | grade | which exhibit |
|---|---|---|
| `tap` | **shipped** — `examples/demo` | many |
| `drag`, `zoom` (wheel + pinch), `CameraController` | **self** | **the landing page** (`G99`) — *"drag to pan, scroll to zoom"* is in its brief. Also every large-world exhibit that wants a camera |
| `GestureProfile`, `ProfileOverrides`, `ProfileScalar`, `DEFAULT_PROFILE`, `PointerKind` | **self** | **the control panel** (`G0`) — `GALLERY.md` names *"the tap-versus-drag thresholds"* and *"set the tap slop to 1 px and discover you can no longer tap anything"*. Covered, and by design |
| `longpress` | **doc** only (`GUIDE.md`) | ❌ **nothing** |
| gamepad | **self** | ❌ **nothing.** The original RFC already flagged this: *"`input.gamepad` is the one module this design never touches"*. It is still true, one design later |

### `@lattice/audio`

| surface | grade | which exhibit |
|---|---|---|
| `createAudio`, `createBed`, `SoundDef`, `BedLayer` | **shipped** — `examples/demo/src/sound.ts` | — |
| **music deck** — `createDeck`, `validateSong`, `Song`, `Track`, `TrackVoice`, `Note`, `SongProblem`, `LOOKAHEAD_SEC`, `PUMP_INTERVAL_MS` | **self** | ❌ **nothing as written.** **Instrument** (`G13`) shows *synthesis*; **Resonance** (`G14`) is chords, a bed, and ducking. A drone is `createBed`. Nothing in the gallery currently needs a *scheduled sequence with lookahead*, which is what the deck is |
| **mixer** — `Mixer`, `MixerState`, `snapshot()`, `restore()`, `effectiveGain` | **self** | ⚠️ partial. **Resonance** (`G14`) exercises bus gains and ducking. `snapshot()`/`restore()` exist, per `packages/audio/src/index.ts`, so a game can hand mixer state to `@lattice/persist` — which needs one artifact holding *audio and a save at once*, and there is no such row |

### And the one nobody listed: `@lattice/ui`

`examples/demo` declared `@lattice/ui` and never imported it; that dependency is removed as part of
`K8`. Look at what replaces it and the position is worse than orphaned:

- Not one of the fifteen exhibit rows names `ui`.
- The control panel — the one obviously UI-shaped thing in the plan — **lives in
  `examples/_shared/` on purpose**, and `GALLERY.md` says so in as many words: *"`@lattice/ui` is
  deliberately not a controls library."*
- *Lamplighter* drew its HUD into the canvas with `draw`, in `hud.ts`.

**`@lattice/ui` is a package the gallery has no planned consumer for at all.** It is `B9`, still
in flight, and this is worth putting in front of whoever finishes it before they finish it.

---

## The uncovered list, ranked

Everything above with a ❌ or a ⚠️ that no planned exhibit currently reaches. Ranked by what the
kit loses if it stays uncovered.

1. **`sim.schedule` entire, and `CatchUp.fromSeconds` above all.** A phased absence with a
   crossing inside it is the hardest thing `sim` does and the only part with a live exploit in its
   history. Nothing exercises it.
2. **`persist` autosave and flush triggers.** The write path. Everything the gallery plans to do
   with `persist` is *reading* — open a v1 save, verify a replay. Nothing writes one on a schedule,
   and nothing flushes one on `pagehide`, which is where saves are actually lost.
3. **`persist` quarantine.** A save store's behavior on a *bad* save is the half that matters, and
   `G12` as written only shows the good one.
4. **`audio` music deck.** A whole module, ~9 exports, with no artifact that needs a sequence.
5. **`iso.anchor`.** Not merely unused — reimplemented by its first would-be user.
6. **`audio` mixer `snapshot`/`restore`.** Needs one exhibit holding audio and a save at once.
7. **`iso.ChunkGrid`.** Genuinely may not belong in a kit whose exhibits all fit one viewport.
8. **`draw.createRecordingSurface` and `spriteBounds`.** Both have obvious homes that no row names.
9. **`input` `longpress` and gamepad.** Two designs in a row have not needed them.

---

## What this asks of `docs/GALLERY.md` and the `G` tasks

`K8` owns none of these paths. They are the actionable output of the ledger and each is one clause
in an existing row.

| # | change | why |
|---|---|---|
| 1 | **`G10` Idle**: widen from *"fourteen hours of offline in one frame"* to *"fourteen hours **that contained fourteen nights**"*, and require it to open a real store so `elapsedSince` supplies the gap | picks up `sim.schedule`, `Phase`, `advanceOver`, `elapsedSince` in one sentence |
| 2 | **`G12` Migration**: add *"and one save it refuses"* | picks up quarantine, `Rejected`, `ReadFailure`, `inspect` |
| 3 | **`G11` Replay**: require the proof to be an **op-stream** comparison, and require it to show one *refused* replay | picks up `createRecordingSurface`, `Divergence`, `Refusal`, `DiagnosticSink` |
| 4 | **`G9` Builder**: name `drawGhost`, `spriteBounds` and `anchor` in the row | `drawGhost` is already implied; the other two are the exhibit's real needs and *Lamplighter* hand-rolled both |
| 5 | **`G13` Instrument**: require a sequenced pattern, not only struck tones — **or cut `audio.music`** | it is a whole module with no reason to exist otherwise, and cutting it is a legitimate answer |
| 6 | **A sixteenth row, or a clause on `G14` Resonance**: one artifact that saves — mixer snapshot, autosave, flush on hide | items 2, 6 and half of the `persist` write path have no other home. `GALLERY.md` forbids meta progression, and *"close the tab mid-chord and reopen it"* is not progression, it is the exhibit |
| 7 | **`B9` `ui`**: before it is finished, decide what in the gallery will ever import it | no row names it, and the one UI-shaped artifact in the plan is explicitly not it |
| 8 | **`C1`–`C9` audits**: hand each auditor their package's rows from this ledger as the starting point | *"never called by anyone with a different goal"* is a far better audit lead than a coverage percentage |
| 9 | **`iso.ChunkGrid`**: put it to the `iso` audit as a **delete** candidate, not a coverage gap | an export with no consumer and no plausible one is a promise the kit should stop making |

The three items with no owner at all after that — `input` gamepad, `longpress`, and `ChunkGrid` —
should be **deleted or documented as deferred**, not left as exports. `AGENTS.md`: *every export is
a promise.*

---

# Appendix A — `D2`: the night you cannot skip

*Preserved verbatim from the retired design. This is the only record of why
`CatchUp.fromSeconds` and `OfflineCurve.uncappedSeconds` are shaped as they are. The game it
argues about does not exist; the arguments are still correct and the field is still in the API.*

> **`sim` T21.** A warp on *time* discounts the lamps' oil by exactly the factor it discounts
> the pilgrims' coin, so LAMP ROAD as written at `D1` rewards closing the tab at dusk: the
> player pays less for the dark hours than they would have by staying, and the road survives a
> night it should have guttered out in. `sim` routed this to me as a design question and it is
> one. Here is the answer.

**Decision: the burn stays inside the warp — one economy, one clock — and the night's teeth
move from *flow* to *state*.** What changes is that a lamp whose oil ran out **stays out until
the player taps it again**, and that single rule inverts the exploit into a penalty without
adding a number to the HUD or a sentence to the tutorial.

The relevant numbers: lamp *n* costs `25 · 1.35ⁿ`; oil is `+4/s per press` always and `−1/s per
lit lamp` only while dark; day is 45 s and night *d* is `15 + 9d` seconds, so night 6 — the
longest in the game — is 69 s and no night exceeds 80 s; the offline curve is
`{ uncappedSeconds: 10800, exponent: 0.625, flatAfterSeconds: 86400 }`. The exponent is `0.625`
rather than `sim`'s shipping `0.6` because 5⁄8 is dyadic with denominator ≤ 64, so `sim` computes
it as `sqrt(x)·sqrt(sqrt(sqrt(x)))` and credited time becomes **Tier A**.

### 1. Oil is not exempt, and an exemption would be two economies

`sim` warps the interval, not the resource. Exempting oil therefore does not mean "one economy
with an asterisk"; it means the oil node is integrated over `T` real seconds while the presses
that *fill* it are integrated over `W(T)` credited ones. A node cannot be integrated on two
clocks, `Economy` has no per-edge warp, and there is no version of this that is one ledger. It
is **two economies, two anchors, and two saved timestamps**, which is the same class of mistake
as two clocks in one game — the one `SEAMS.md` says overwrote a player's company name in the
game this kit came from.

The concrete bill for that split is the demo's best sentence. `oil(t) = oil₀ + P·W(t) − L·t` has
a fractional power in it, so it is not a polynomial in `t`, so `solveCrossing`'s degree table
does not apply and `solveCrossingOver` cannot be called at all. *"The far lamps went out at 3:41
into the second night"* would have to be bisected by hand in `rules.ts` — a second, slower,
game-owned root-finder disagreeing in the last ulp with the kit's, on exactly the saves that
matter most. The exemption costs the demo the one capability it exists to prove.

And it does not even balance. The warp factor grows with the absence, so an unwarped burn against
a warped income makes the *survivability of the road a function of how long the player slept*,
in the punishing direction and by an amount they cannot see. Eight hours away at the shipping
curve credits 1.44× less income per real second than three hours away does, against a burn that
is identical — so the same road that holds through a nap goes black through a night's sleep, for
reasons entirely outside the fiction. Trading "closing the tab is rewarded" for "closing the tab
is punished on a hidden curve" is not a fix. It is the same bug with the sign flipped, and the
sign that is flipped is the one the player would have to reason about.

The fiction argument does not survive either. *The lamps burn whether or not you are watching* is
true, and so is *the pilgrims walk whether or not you are watching*. The warp is not a claim about
attention; it is an out-of-fiction courtesy about absence. Applying a courtesy to one side of a
ledger makes it visible as a rule, and the visible version reads as the game charging you for time
it declined to pay you for.

**Rejected. One economy, one clock, one anchor.**

### 2. The exploit needs an absence 135 times longer than the thing it skips

`W(T) = T` for `T ≤ uncappedSeconds`. **Below the knot there is no warp at all.** At `U = 3 h`
against this design's 80-second ceiling on a night, the ratio is 135:1 — and the entire game,
gate to shrine, is about ten minutes, which is an *eighteenth* of the uncapped window. A player
cannot warp anything in this game by closing the tab, because the game is over before the curve
begins to bend.

So the exploit as stated does not exist at the granularity a player could aim. To reach the
softcap you must be away for three hours, by which time you have missed forty-odd cycles and
have not "skipped the night" — you have gone to bed. **The rule the kit should carry out of
this, and it belongs beside `OfflineCurve.uncappedSeconds`:**

> If a game's standing charge accrues on a cycle, `uncappedSeconds` must exceed the period of
> that cycle by a wide margin, or the cycle is skippable. A player can aim an absence at a
> minute. Nobody can aim one at three hours.

### 3. What the warp cannot discount is the dark road it leaves behind

Part 2 closes the aimable case and leaves the honest one: the player who genuinely returns
tomorrow. There the warp *does* shrink the aggregate oil bill. It does not matter, and the reason
is the rule in the decision line.

The player who leaves is, by construction, one whose oil crosses zero — an overextended road is
the only road with anything to skip. `solveCrossingOver` finds that crossing inside the credited
window, the top lamp goes out, `buildFlow` runs one lamp lighter, and the loop repeats until the
lit road is one the presses can hold. That fixpoint is not a punishment and not a reward; **it is
this game's own thesis, evaluated while the player was away** — *the road you could afford to
light in autumn gutters out in winter.* The absent player does not skip winter. They get the
result of winter, computed exactly, and they get it as a place rather than as a number.

And because the lamps stay out, the discount inverts:

- The saving is bounded by one night's oil bill.
- The loss is the income differential — a shortened `reach` against `pilgrims · k · reach^0.5` —
  integrated over **the entire remainder of the absence**, which is the part that grows.

A stayer relights at each dawn and holds their reach. A leaver's road collapses to the affordable
fixpoint on the fourth night and earns at that shorter reach for the other fifty-six. For any
absence long enough for the warp to bite, the second number is larger than the first and gets
larger the longer they are gone. **Closing the tab is never a win, and the mechanism that makes
it a loss is the same one that produces the middle game's best beat.**

### What this asked of `@lattice/sim` — and got

**`advanceOver` and `solveCrossingOver` must be able to resume a partially-consumed absence
without restarting the warp.** Each extinguishment is a commit partway through the absence, and
calling `advanceOver` again with a fresh `spanSeconds` restarts `W` at that instant, which is
precisely the "pays for K absences instead of one" error the schedule module exists to prevent.
Here it is worse than usual, because each restart is *cheaper* for the player: the exploit would
climb back in through the function that closes it.

The fix was one field — a crossing is a phase boundary, one discovered rather than scheduled, and
`W` distributes across a partition by evaluation at absolute offsets:

```ts
export interface CatchUp<G extends string> {
  readonly spanSeconds: number;
  /**
   * Real seconds of THIS absence already consumed by an earlier call. Required, not optional:
   * a forgotten `0` is the K-absences bug and it pays out silently.
   *
   * `phases` and `spanSeconds` stay relative to the absence origin; the credit for this call is
   * `W(spanSeconds) − W(fromSeconds)`, so a sequence of calls telescopes to exactly `W(T)` and
   * the once-per-return rule is preserved by the same mechanism that already distributes the
   * warp across phases.
   */
  readonly fromSeconds: number;
  readonly phases: readonly Phase<G>[];
  readonly curve: OfflineCurve | null;
}
```

`Crossing.atSeconds` is documented as *real* seconds from the anchor, which is exactly the number
that goes into `fromSeconds` on the next iteration.

**It shipped. It has no caller. That is the ledger's first entry.**

### The alternatives, and why not

| option | why not |
|---|---|
| **Exempt the standing charge from the warp** | Two economies, two anchors, and `solveCrossingOver` no longer applicable — see part 1. It also replaces a reward for leaving with a hidden, absence-length-dependent punishment for it |
| **Lamps do not burn while you are away** | Then night is not a standing charge, `reach` is free to hold, and the game's one hard decision evaporates in the other direction. It also makes the offline path a different simulation from the live one, which is the thing `sim` refuses on the grounds that the two will diverge silently |
| **Resume from where you left, credit nothing** | This is a game with no offline progress. It discards `offline`, `advanceOver` and `Crossing` — three of the four capabilities this demo exists to exercise — and makes *"Two days and two nights passed"* unwritable |
| **Accept it** | A generous idle game is a real position, and part 2 shows the demo is already accepting it for every absence under three hours, which is every absence a player can aim. What I will not accept is the long absence being *free*, because winter is the game |

---

# Appendix B — what the retired design got right, and what it got wrong

Worth one screen, because the next design document in this repo will be written by someone who
should read it.

**Right, and it held:**

- *The lit road is the economy — a place, not a stat.* This survived every cut and is the whole
  reason *Lamplighter* works at ninety seconds.
- **The line budget.** Publishing per-file budgets and alarms *before* a line was typed, with an
  explicit statement of what each alarm would mean about the kit, produced better findings than
  the code did. Every gallery exhibit should do this.
- **The ranked gap list.** Items 1, 2, 3 and 6 — `pathSample`, the light primitive, elevation, and
  `Palette.lerp` — were all delivered and are all named in `examples/demo/README.md` as the seams
  that fit best. Ranking gaps by *how badly this game needs them* worked.
- **The last open question**, which asked whether `uncappedSeconds = 3 h` meant the demo never
  exercised the softcap branch of `sim`'s own curve, and said *"the most interesting third of
  `offline` is covered by nothing."* It was right, it was written a fortnight early, it was about
  the wrong third, and nobody acted on it. **The orphan ledger above is that question, generalized
  and finally answered.**

**Wrong:**

- It sized a game at 345 lines and got a game that needed 1,450. The kit was not the reason.
- It treated the capability matrix as a *specification of the kit*, when it was in fact the kit's
  only load. When the game was cut, nobody re-derived the matrix against what replaced it, and a
  third of the kit quietly stopped having a caller. **A design document that is the sole consumer
  of nine packages must say so, so that retiring it triggers a review rather than a deletion.**
  This retirement is that review, run about three weeks late.
