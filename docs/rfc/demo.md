# LAMP ROAD — the demo game the kit must be able to build

> **Status:** design, revised at `D2`. Nothing is implemented.
> **This document is the acceptance test for the other nine RFCs.** Every beat below names
> the capability it needs and the package that owes it. A package RFC that cannot serve its
> column here is not finished, however internally coherent it is.
>
> **`D2` decides `sim`'s T21** — the standing-charge exploit — in *The night you cannot skip*,
> below. It changes one rule of the game and adds one requirement to `@lattice/sim`.

---

## The pitch, in one screen

A valley at dusk. A road climbs from the town gate, past the river, up to a shrine on the
ridge that is dark and will stay dark until you do something about it. You are the
lamplighter. You tap a lamp post; it lights; the pool of warm light spills onto the road;
and the pilgrims — who will not walk into the dark — go one lamp further than they did
before, and come back with coin.

That is the whole game. **The lit road is the economy.** Its length is the only number that
really matters, and it is a *place*, not a stat: the player can see exactly how far they have
got by looking at where the gold stops and the blue begins.

And every night is longer than the one before, because the year is turning. The road that was
long enough yesterday is not long enough tonight.

Nothing to read, nothing to sign, nothing to dismiss. The world renders, one lamp post
pulses, and one line of text says **Light the first lamp.**

## The loop

```
   light a lamp ─▶ the lit road runs further ─▶ pilgrims walk further ─▶ coin
        ▲                                                                  │
        │                                                                  ▼
    more wicks ◀── build an oil press ◀───────────── spend ◀───────────────┘
        │
        └── but every lamp burns oil, and every night is longer than the last,
            so a road you can afford to light in autumn guts out in winter.
```

Twenty seconds is a complete session. The valley accrues while you are gone — and so does the
dark.

## The joke, which is also the curriculum

**The light costs more than the journey.**

Reaching further is always worth it — a pilgrim's offering scales with how far they walked.
But the road you reached with has to be *held* every night, forever, and the nights are
getting longer. Growth is one payment; light is a standing charge. Every player overextends
exactly once: they light four lamps in a happy afternoon, night falls, oil goes negative, and
the far lamps gutter out one by one from the top of the road down while the pilgrim line
visibly shortens in front of them.

**And they do not come back on at dawn.** The post is still yours; the flame is not. Relighting
is free and takes one tap, but somebody has to be there to take it — which is why an absence
cannot be used to duck a night, and is the whole of `D2` below.

Nobody explains this. The player causes it by doing the obviously correct thing, and then the
card says **The far lamps went out** and the fix is *spatial*, not financial: there is a
shorter way over the ridge, behind a rockfall, and the same lamps light a shorter road better.
Clearing it re-routes the pilgrims in front of the player's eyes — one call into the
pathfinder, visible as a crowd changing its mind.

That is why this demo is not another base-builder. A base-builder proves the economy package.
**This proves the economy package and the pathfinder in the same mechanic**, which is the seam
nine parallel RFCs are most likely to get wrong.

## Resources

| | is | comes from | spent on |
|---|---|---|---|
| **COIN** | a stock | pilgrims returning | lamps, presses, the rockfall, the shrine |
| **OIL** | a stock with a *negative* rate at night | oil presses | burned by every lit lamp, every night |
| **WICKS** | a **capacity, not a stock** | presses | how many lamps can burn before oil drains |

Two pills in the wallet. Neither appears until the player has earned some — a HUD of zeroes
on the first frame is two things to ignore.

## The numbers, enough for a builder to start

| thing | rule |
|---|---|
| lamp *n* | `25 · 1.35ⁿ` coin |
| press *n* | `120 · 1.60ⁿ` coin, placed on a flat riverside 2×2 |
| rockfall | 400 coin, once |
| shrine brazier | 2500 coin, and burns as much as six lamps |
| reach | arc length along the best path from the gate to the furthest lit lamp |
| pilgrims | `min(⌊reach / spacing⌋, 1 + lampsLit)` — the road holds only so many |
| coin rate | `pilgrims · k · reach^0.5` (offering scales `reach^1.5`, trip time scales `reach`) |
| oil | `+4/s per press`, always; `−1/s per lit lamp`, only while dark |
| day | 45 s, always |
| night *d* | `15 + 9d` seconds. Night 0 is 15 s. Night 5 is a minute. |
| longest night | night 6, beginning at about 9:00. **69 s.** No night in this game exceeds 80 s |
| a lamp whose oil ran out | **goes out and stays out.** The post is still built; the flame is not. Relighting is free, manual, and one tap |
| the offline curve | `{ uncappedSeconds: 10800, exponent: 0.625, flatAfterSeconds: 86400 }` — 3 h, 5⁄8, 24 h |

`reach` is the master variable and everything is closed form in it. There is no tick.

The last two rows are the whole of `D2` and the reasoning is the next section. The exponent is
`0.625` rather than `sim`'s shipping `0.6` because 5⁄8 is dyadic with denominator ≤ 64, so
`sim` computes it as `sqrt(x)·sqrt(sqrt(sqrt(x)))` and credited time becomes **Tier A** — a demo
whose headline claim is *same seed, same pixel* should not have a `**` in the one function that
decides how much of the player's night was real.

---

## The night you cannot skip

> **`sim` T21.** A warp on *time* discounts the lamps' oil by exactly the factor it discounts
> the pilgrims' coin, so LAMP ROAD as written at `D1` rewards closing the tab at dusk: the
> player pays less for the dark hours than they would have by staying, and the road survives a
> night it should have guttered out in. `sim` routed this to me as a design question and it is
> one. Here is the answer.

**Decision: the burn stays inside the warp — one economy, one clock — and the night's teeth
move from *flow* to *state*.** Nothing about §3.4 changes. What changes is that a lamp whose oil
ran out **stays out until the player taps it again**, and that single rule inverts the exploit
into a penalty without adding a number to the HUD or a sentence to the tutorial.

Three parts, in the order they matter.

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

This is the part `D1` missed, and it is the reason the fix is a curve parameter rather than a
mechanic.

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

The demo therefore keeps `U = 3 h` — not inherited from the source game, but *chosen* against a
69-second longest night, and written down here so a later balance pass that shortens `U` knows
exactly what it is spending.

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

Relighting is free and manual. Free, because `sim`'s own generator exemption argument applies —
a fail state you cannot dig out of is a dead save, not a stake. Manual, because the thing the
game legitimately charges an absent player is *attention*: the road is dark until somebody
notices, and noticing is the game.

### What this asks of `@lattice/sim`

One requirement that changes a signature, and one that changes a doc comment. Both are free,
because nobody has started building.

**`advanceOver` and `solveCrossingOver` must be able to resume a partially-consumed absence
without restarting the warp.** The guttering loop in `sim` §3.6 is written against live time —
`advance` plus a plain horizon — and it cannot be run under a schedule as the surface stands.
Each extinguishment is a commit partway through the absence, and calling `advanceOver` again with
a fresh `spanSeconds` restarts `W` at that instant, which is precisely the "pays for K absences
instead of one" error §3.5 exists to prevent. Here it is worse than usual, because each restart
is *cheaper* for the player: the exploit would climb back in through the function that closes it.

The fix is one field, and §3.5's own argument already licenses it — **a crossing is a phase
boundary, one discovered rather than scheduled**, and `W` distributes across a partition by
evaluation at absolute offsets:

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

The two APIs already interlock: `Crossing.atSeconds` is documented as *real* seconds from the
anchor, which is exactly the number that goes into `fromSeconds` on the next iteration. `sim` has
the machinery; what it lacks is the entry point that lets a caller re-enter mid-absence. The game
side is the §3.6 loop with `plan` threaded through it, bounded by the number of lit lamps, and it
is the eight lines `rules.ts` already budgeted for a cycle clock plus about six more.

Also requested, and cheap: **say beside `OfflineCurve.uncappedSeconds` what part 2 says.** T21 is
a trap for the *designer*, and the place a designer meets it is the field they are choosing a
number for.

### The alternatives, and why not

| option | why not |
|---|---|
| **Exempt the standing charge from the warp** | Two economies, two anchors, and `solveCrossingOver` no longer applicable — see part 1. It also replaces a reward for leaving with a hidden, absence-length-dependent punishment for it |
| **Lamps do not burn while you are away** | Then night is not a standing charge, `reach` is free to hold, and the game's one hard decision evaporates in the other direction. It also makes the offline path a different simulation from the live one, which is the thing `sim` §4.3 refuses on the grounds that the two will diverge silently |
| **Resume from where you left, credit nothing** | This is a game with no offline progress. It discards `offline`, `advanceOver` and `Crossing` — three of the four capabilities this demo exists to exercise — and makes *"Two days and two nights passed"* unwritable |
| **Accept it** | A generous idle game is a real position, and part 2 shows the demo is already accepting it for every absence under three hours, which is every absence a player can aim. What I will not accept is the long absence being *free*, because winter is the game. Part 3 is what makes that acceptance safe rather than a shrug |

## The first five minutes, beat by beat

| time | what happens | which package must provide it |
|---|---|---|
| 0:00 | The valley renders in dusk gold: gate at the bottom, road climbing past the river, shrine dark on the ridge. One unlit lamp post pulses. One line: *Light the first lamp.* No splash, no modal. | `iso` projection+camera+tilemap **with elevation**; `draw` solids+palette+layers; `core` noise (the heightfield); `loop` |
| 0:04 | Tap. The flame swells over 400 ms, a warm pool spills across three road tiles, and the audio context unlocks on that same gesture with the strike. | `input` pointer tap; `loop` tween; `draw` **light/glow**; `audio` engine unlock + synth |
| 0:09 | A pilgrim walks out of the gate, to the lamp, and back. `+3` floats off them. The COIN pill appears and rolls. | `iso` **path + sample-along-path**; `sim` flow; `ui` roll; `core` pool (the float) |
| 0:20 | Lamp two is affordable. Card: *Light the road further.* Pilgrims now walk visibly further and there are visibly more of them. | `sim` cost curve; `ui` panel |
| 0:45 | **First nightfall.** The palette rolls from gold to blue over six seconds, everything outside a lamp pool goes dark, and the pilgrims turn around at the last lit lamp. The OIL pill appears with a burn rate under it. | `loop` scheduler; `draw` **palette interpolation + night mask**; `sim` capacity |
| 1:00 | Dawn, 15 seconds later. That was easy. It will not stay easy. | `loop` |
| 1:05 | Card: *Build an oil press.* A ghost footprint follows the pointer and refuses to sit anywhere but flat riverside ground. | `input` drag; `iso` **footprint fit against a heightfield**; `draw` |
| 1:40 | Four lamps. Word has spread — more pilgrims than the road holds. Buying reach stops paying. Card: *The road is full, not the valley.* | `sim` **capacity clamp**; `iso` path |
| 2:09 | **Second night, 24 s.** Oil hits zero partway through. The top lamp gutters with a puff of smoke, then the next, and the pilgrim line shortens in front of the player. | `sim` **solve for depletion time**, then re-solve one lamp lighter — a loop bounded by lamps, not by time; `draw`; `audio` |
| 2:33 | **Third dawn, and the two lamps are still dark.** They did not come back on. The posts are there, drawn cold; the pilgrims still turn around below them. Card: *Two lamps went out. Relight them.* Tap, tap — free, and the road is whole again. This is the entire teaching of `D2` and it costs one card and two taps | `draw` **a built-but-unlit lamp state**; `ui` panel; `input` tap |
| 2:54 | The camera pans up the ridge to a rockfall and holds. Card: *There is a shorter way.* 400 coin. | `loop` tween (camera); `ui`; `iso` camera |
| 3:10 | Rockfall cleared. **Every pilgrim on the map re-routes over the ridge**, same lamps, shorter road, and the coin rate jumps without a single purchase. | `iso` **weighted-cost path + recompute on tile change** |
| 3:27 | **Third night, 33 s.** Now longer than the run to the shrine takes. Presses matter more than lamps. Buy-max on presses is one call, not a loop. | `sim` cost closed form |
| 4:12 | Ridge lamps. The shrine's silhouette is finally inside the last lamp pool, still unlit. The card names it for the first time: *Light the shrine before the longest night.* | `ui`; `draw` text |
| 4:54 | **Fourth night, 42 s.** Longer than day. The player is now playing the actual game the first four minutes were teaching. | everything above |

Something new every 45–90 seconds, and the gap never more than doubles. The five-minute mark
is where the tutorial stops being invisible and starts being scenery.

### Session two, at 0:00

Close the tab. Come back. Before anything is tappable, one toast — and **the copy is derived
from the crossing, never assumed**, because how long the player was away decides which sentence
they get.

**Away four minutes** (unwarped, `T < uncappedSeconds`, so every second was paid for in full):

> **Two days and two nights passed.** 1,240 coin. The four highest lamps went out at 3:41 into
> the second night, and are still out.

**Away eight hours.** `W(28,800 s)` at the demo's curve is 19,937 s — **five and a half hours
credited, sixty days and sixty nights**:

> **Sixty days and sixty nights passed.** 9,100 coin. The road went dark on the fourth night.
> The pilgrims have been turning back at the third lamp ever since.

That second sentence is `D2` doing its job in one line. The player is not told a rule; they are
told what happened, and what happened is that the road collapsed to the length their presses
could hold and then earned at that length for fifty-six nights. Nothing was skipped.

Past 24 hours the curve is flat: `maxOfflineCredit` is about 11 hours, roughly **87 days and 87
nights**, and a device whose clock jumped a year reports the same 87. The toast can therefore
never claim more than the physics did.

Those sentences are a load-bearing test of three packages at once: `persist` for the stamped
save, `loop` for the injected clock, and `sim` for accruing across an **alternating** day/night
rate, *solving* for the moment the oil ran out rather than discovering it by ticking, and
**resuming the same absence after each lamp gutters without restarting the warp** (`D2`). If any
of the three RFCs owns none of the timestamp, that toast cannot be written; if `sim` has no
`fromSeconds`, the second one is written and wrong.

---

## The ending

**The Longest Night**, at roughly nine to eleven minutes.

The shrine has been visible and dark since frame one. To light it the player needs two things
they have spent the whole game acquiring: an **unbroken lit path from gate to shrine**, and
enough **wicks** to hold it plus the brazier, which burns as much as six lamps.

*Unbroken* is doing real work after `D2`: a lamp that guttered on the sixth night is still out
on the seventh, so the last minutes of the game are a walk up the road relighting the gaps
before the final tap — the player retracing, by hand, exactly the road the economy took from
them. That is the best possible use of the rule, and it was free.

Tap the brazier on the longest night and:

1. The ignition runs *up the road*, lamp by lamp, staggered by each lamp's arc-length along
   the path — the same sampling function that walks the pilgrims, reused.
2. The night palette warms from blue toward gold; for the first time the valley is lit at
   night and looks like the first frame of the game, which it has not looked like since 0:45.
3. Every pilgrim on the map turns and walks up together, no longer stopping anywhere.
4. A chord builds out of the same oscillators the lamp strikes came from.
5. One line, and then nothing further to buy:

   > *The road is lit. They will find their way now, with or without you.*

The save is stamped `finishedAt`. The HUD retires to a single line. The game keeps running —
you can watch the valley you lit — but the loop is closed and it says so.

**No prestige layer.** It is the direct enemy of having an ending, and an idle game with no
terminal beat has no reason to be finished. This one has a reason: the dark thing at the top
of the screen that has been there since the first second, and the player is the only one who
can do anything about it.

---

## The capability matrix

This is the real deliverable. **Claim** is what `.lattice/kit.json` currently promises:
✓ named in the module list, ~ implied but not named (the risk column), ✗ nothing claims it.

### `@lattice/core`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| seeded RNG, bit-identical | `rng` | ✓ | everything |
| **named sub-streams** (`rng.stream('lamp:14')`) | `rng` | ~ | per-lamp flicker and per-pilgrim gait must be stable regardless of *creation order*, or the valley reshuffles itself when a lamp is bought out of sequence |
| **`hash2(x, y) → 0..1`**, white, not smooth | `noise` | ✗ | per-tile grass tufts and stone speckle with zero stored state. Value noise is smooth and cannot do this |
| 2D value noise for the heightfield | `noise` | ✓ | the valley is a flat mat |
| easing for flame swell and palette rolls | `easing` | ✓ | the ignition reads as a toggle |
| typed events, game → HUD | `events` | ✓ | HUD polls, which couples it to the frame loop |
| pooled float-text and smoke puffs | `pool` | ✓ | GC pauses under a full road |
| `1.2k` formatting | `format` | ✓ | wallet is unreadable by minute six |

### `@lattice/iso`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| grid ↔ world ↔ screen | `projection` | ✓ | — |
| **elevation: a per-tile height that the projection honours** | `projection`/`tilemap` | ✗ | there is no ridge, no river bank and no valley. This is the single largest visual assumption in the design and nothing in the module list mentions z |
| camera with pointer-anchored zoom, clamped to valley bounds | `camera` | ~ | the clamp is not named; without it the player pans into the void in the first ten seconds |
| depth sort ~200 sprites | `depth` | ✓ | pilgrims walk through lamp posts |
| tile map with terrain type + height | `tilemap` | ~ | see elevation |
| **footprint fit tested against terrain flatness**, not just occupancy | `footprint` | ~ | the press can be placed on a cliff |
| tap → tile, computed from state and camera | `hittest` | ✓ | — |
| **weighted-cost pathfinding** (terrain cost, not just passable/blocked) | `path` | ~ | the ridge-versus-river decision *is* the mid-game. Binary walkability cannot express "shorter but rougher" |
| **path recompute on a tile change**, cheap enough to run on a tap | `path` | ~ | the rockfall beat |
| **sample a point at arc length `s` along a path, into an out-param** | `path` | ✗ | **no walkers.** The entire crowd is `pathPointAt(path, frac(t·v + i/n)·len, out)` — closed form, no per-walker state, deterministic, zero allocation. Without this the demo needs a walker simulation and the line budget triples |
| total arc length of a path | `path` | ~ | `reach` is the game's master variable |

### `@lattice/draw`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| Surface + Canvas2D backend | `surface`/`canvas2d` | ✓ | — |
| iso box, post, cylinder, roof for lamp/gate/press/shrine | `solids` | ✓ | — |
| face colours derived from one colour | `color` | ✓ | — |
| **interpolate two named palettes by `t`** (dawn → day → dusk → night) | `palette` | ✗ | the day/night cycle is the spine of the game. Recolouring the whole world should be one call and one number, which is the strongest argument the zero-asset rule has |
| **an emissive light: additive radial glow with a falloff** | — | ✗ | a lamp that does not glow is a stick |
| **a night mask: a darkness layer that lamp lights punch through** | `layers` | ✗ | **the premise.** The player must be able to see, at a glance, where the light stops. Without this there is no game, only a recolour |
| **a built-but-unlit lamp that reads as *different from* an unbuilt site** | `solids`/`color` | ~ | **`D2`.** Lamps now stay out after guttering, so "dark post you own" and "dark post you could buy" are two states on the same silhouette and the player must tell them apart at a glance to know what to tap. One derived colour and no glow, but the design did not have this state before this revision |
| contact shadows under posts and pilgrims | `shadow` | ✓ | everything floats |
| static geometry cached (trees, ground chunks) | `cache` | ✓ | frame budget |
| world-space text for the shrine name | `text` | ✓ | minor |
| layer order: ground, shadow, sprites, **light**, overlay | `layers` | ~ | the light layer needs to composite additively above sprites and below UI |

### `@lattice/loop`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| fixed-step sim, interpolated render | `loop` | ✓ | — |
| **wall-clock, so night falls in a hidden tab** | `clock` | ✓ | the whole day/night premise |
| clamped catch-up | `clock` | ✓ | returning after an hour runs an hour of dusk transitions in one frame |
| scheduled dawn/dusk transitions | `scheduler` | ✓ | — |
| tweens: flame swell, palette roll, camera pan to the rockfall | `tween` | ✓ | every beat reads as a jump cut |
| **a cycle clock: position 0..1 through a period whose length changes each cycle** | — | ✗ | ~8 lines of game code. *Acceptable as game code* — noted so nobody counts it as a kit failure |

### `@lattice/input`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| tap vs drag discrimination | `pointer`/`gestures` | ✓ | every pan lights a lamp |
| drag-pan and pinch-zoom camera controller | `cameracontrol` | ✓ | — |
| **tap → grid cell**, as one composed thing | seam with `iso.hittest` | ~ | **the seam most likely to fall between two RFCs.** Both packages can plausibly disown it. Somebody must own it, and the demo needs it in the first four seconds |
| drag a ghost footprint, with a validity read per move | `pointer` | ~ | press placement |
| hover preview on desktop, tap-to-preview on touch | `pointer` | ✗ | small, but the press placement is unreadable without it |
| every listener returns a disposer | all | ✓ | — |
| gamepad | `gamepad` | ✓ | **the demo never touches it.** A module no game needs is a module worth questioning |

### `@lattice/audio`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| unlock on the first gesture — which is the first lamp tap, conveniently | `engine` | ✓ | — |
| synthesised strike, gutter-out puff, coin, chord | `sounds` | ✓ | — |
| **hard voice ceiling** under forty pilgrims' footsteps | `voice` | ✓ | the design deliberately generates more voices than any ceiling should allow; that is the test |
| sfx / ambience buses | `bus` | ✓ | — |
| **a parameterised ambience drone that crossfades day ↔ night** | `music` | ~ | `music` reads as a sequencer. A drone following a 0..1 parameter is a different shape, and it is what the day/night cycle actually needs |
| silent, not throwing, with no WebAudio | `engine` | ✓ | tests |

### `@lattice/persist`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| versioned save + explicit migration chain | `store`/`migrate` | ✓ | — |
| **a real v1 → v2 migration shipped in the demo**: v1 held `lampsLit: number`, v2 holds `lamps: LampId[]` because lamps became individually addressable when they started guttering out from the top | `migrate` | ✓ | the demo ships a v1 fixture and boots it. A migration chain with only one link has never been tested. **`D2` makes this load-bearing rather than illustrative**: a guttered lamp stays out across a save, so *which* lamps are lit is now durable state and a count cannot express it |
| debounced writes, flushed on `visibilitychange` | `store` | ✓ | mobile Safari eats the last minute |
| corrupt save → fresh, with a reported reason | `integrity` | ✓ | — |
| **the saved-at timestamp** that offline accrual reads | seam: `persist` ↔ `loop` ↔ `sim` | ✗ | **three packages, one number, and each can reasonably assume another owns it.** If all three RFCs are silent, the offline toast cannot be written and nobody finds out until `D1` |

### `@lattice/sim`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| cost curve, and buy-max in closed form | `cost` | ✓ | — |
| stocks and rates integrated on read, no tick | `flow` | ✓ | — |
| production graph: presses → oil, pilgrims → coin | `graph` | ✓ | — |
| **capacity clamp** (`min(roadCapacity, pilgrims)`; wicks vs lit lamps) | `capacity` | ✓ | the "road is full" beat and the whole oil gate |
| **offline accrual across an alternating piecewise rate** (day rate, night rate, boundaries that move because nights lengthen) | `offline` | ✓ | returning after two days is simply wrong. Served by `advanceOver` + `Phase[]`; the generator is the game's eight lines |
| **solve for the time a stock hits zero**, in closed form | `flow`/`capacity` | ✓ | "the far lamps went out at 3:41 into the second night" — both live and offline. Served by `solveCrossing`/`solveCrossingOver`; oil is degree 1, so exact and Tier A |
| offline warps time, never yield | `offline` | ✓ | — |
| **resume a partially-consumed absence without restarting the warp** (`CatchUp.fromSeconds`) | `offline` | ✗ | **`D2`, and the only new demand this revision makes.** Every guttered lamp is a commit partway through an absence. Without it the guttering loop must re-enter `advanceOver` with a fresh span, which restarts `W`, pays for K absences instead of one, and lets the standing-charge exploit back in through the function that closes it. One required field; see *The night you cannot skip* |
| **`Crossing` carrying both clocks** (real seconds and credited seconds) | `offline`/`flow` | ✓ | the toast says *"3:41 into the second night"*, which is real time; the solve happens in credited time. `Crossing.atSeconds` is also the value `fromSeconds` takes on the next iteration, so the two APIs interlock |
| a **dyadic `exponent`** computed as a `sqrt` chain, not `**` | `offline` | ✓ | the demo picks `0.625` so credited time is Tier A. A determinism proof with a fractional `**` in the offline path is not a proof |
| **`OfflineCurve.uncappedSeconds` documented as a design constraint**, not just a number | `offline` | ~ | T21 is a trap for the designer, and the designer meets it at the field they are choosing a number for. *If your standing charge accrues on a cycle, `U` must exceed the cycle's period by a wide margin, or the cycle is skippable* |

### `@lattice/ui`

| capability | module | claim | what breaks without it |
|---|---|---|---|
| wallet pills that appear on first earn, with number rolls | `roll`/`el` | ✓ | — |
| the objective card — one line, always naming the next action | `panel` | ✓ | the ten-second promise |
| toasts, including the multi-line offline report | `toast` | ✓ | — |
| buy buttons with an affordable / unaffordable state | `el` | ~ | not named; every idle game needs it |
| lamp and press thumbnails rendered through `draw` into an offscreen surface | `thumb` | ✓ | — |
| **the day/night palette reaching the DOM as CSS custom properties** | seam: `draw.palette` → `ui` | ✗ | at nightfall the world goes blue and the HUD stays gold, and the whole illusion collapses at the one moment the game is showing off |
| overlay updates on an interval, not in the frame loop | all | ✓ | hidden-tab freeze |

---

## The gaps, ranked

Ordered by how badly *this game* needs them, which is the only ranking this document is
entitled to.

1. **`iso.path` — sample a position at arc length along a path** (out-param). No walkers
   without it, and the walkers are the game. Also unblocks the ending's ignition wave.
2. **`draw` — a light primitive and a night mask.** The premise is "you can see where the
   light stops". Without these, night is a recolour and the game has no subject.
3. **`iso` — elevation.** A valley with no z is a rug with a road painted on it.
4. **`sim.offline` — resuming an absence without restarting the warp** (`CatchUp.fromSeconds`).
   The `D1` entries here were piecewise alternating rates and solve-for-depletion-time; `sim`
   now serves both. What is left is the seam between them — a crossing *inside* a warped
   absence — and it is the only thing on this list that is a live exploit rather than a missing
   feature. Invisible until a player closes the tab, and profitable when they do.
5. **`iso.path` — weighted terrain cost and cheap recompute.** The mid-game decision.
6. **`draw.palette` — interpolate two palettes by `t`, and expose it to `ui` as CSS vars.**
   The day/night spine, and the strongest single argument for the zero-asset rule.
7. **The saved-at timestamp seam** (`persist` ↔ `loop` ↔ `sim`). Three owners, therefore
   none.
8. **`core.rng` named sub-streams and `hash2`.** Cheap to add, and their absence shows up as
   a valley that quietly reshuffles itself.
9. **The tap → grid cell seam** (`input` ↔ `iso`). Needed at 0:04 of the first session.
10. **`audio` — a parameterised drone.** The cycle is silent otherwise, which is survivable.

Two smaller notes for the architects: **`input.gamepad` is the one module this design never
touches**, and `audio.music` is only touched if it can be a drone rather than a sequence.

---

## The line budget

Real TypeScript, `examples/demo/src/`, excluding comments and blank lines. If a file comes in
at more than its **alarm**, the kit is missing something and the number tells us where.

| file | what it holds | budget | alarm | what the alarm means |
|---|---|---|---|---|
| `main.ts` | boot, wiring, mode machine, the frame callback | 60 | 100 | the seams between `loop`, `input`, `draw` and `ui` need a harness nobody wrote |
| `valley.ts` | seed → heightfield, river, road spline, lamp sites, rockfall | 50 | 85 | `core.noise` or `iso.tilemap` is not enough to describe terrain |
| `sprites.ts` | lamp, pilgrim, gate, press, shrine, tree, ground tile | 90 | 130 | `draw.solids` is missing a primitive — probably lights, probably curves |
| `rules.ts` | costs, rates, capacity, day/night `Phase[]`, the guttering loop, objective spine | 70 | 100 | `sim` is missing capacity, cycles, the depletion solve, or `fromSeconds` — if the guttering loop alone is more than fifteen lines, it is the last of those |
| `hud.ts` | wallet, objective card, buy buttons, toasts | 40 | 65 | `ui` is a set of parts, not a set of primitives |
| `save.ts` | v1 and v2 schemas, the migration, the offline report | 20 | 35 | `persist` needs the timestamp seam resolved |
| `sound.ts` | six sound definitions and the ambience parameter | 15 | 25 | `audio.sounds` is not declarative enough |
| **total** | | **345** | **≈500** | past 500, the kit failed, not the design |

The budget is a claim about the kit, not about the game. **A design this small coming in at
three times its budget is the most useful failure this project can produce**, which is why the
numbers are written down before a line is typed.

---

## What is deliberately absent

- **Free placement of lamps.** They sit at generated sites along the road. Build-anywhere is
  an entire second game's worth of UI, and it would let the player build a road that the
  pathfinder cannot make interesting.
- **A third currency.** Two pills and one capacity. The source game shipped four and its own
  design notes ask whether that was one too many.
- **Prestige.** It is the direct enemy of an ending. Settled.
- **Walker AI.** The crowd is closed form: pilgrim *i* is at `frac(t·v + i/n)` along the path.
  Deterministic, allocation-free, replayable, and about twelve lines. Any beat that needs a
  walker to have a *state* is a beat this design will change rather than fund.
- **A tutorial, a modal, a splash, a loading bar, a settings menu, a minimap, achievements.**
  The objective card is the entire tutorial and it is one line long.
- **Any network call, account or server.** The storage adapter is the whole backend.
- **Sound before the first tap.** The first tap both lights the lamp and unlocks the audio
  context; nothing is more insulting than a permission prompt at second zero.

## Determinism, and how it is proved

`?seed=…` in the URL hash chooses the valley; absent, the seed is a constant. The seed drives
the heightfield, the river, the road spline, the lamp sites, the tree scatter, and the
per-pilgrim jitter — everything. The demo therefore doubles as the kit's determinism proof:
**same seed, same valley, same pixel, and a session replayable from the seed and an input
log.** Anything in the game reaching for wall-clock time does so through the injected clock,
which is what makes that replay possible.

## Open questions

- Whether the rockfall re-route lands as a *revelation* or as a chore. It is the design's
  biggest bet and the one I would cut first if a player pass says the pilgrims changing route
  is not legible at a glance.
- Whether nine to eleven minutes is the right length for the ending. Too short and the
  economy never gets to be an economy; too long and no reviewer reaches the shrine.
- Whether the guttering-out sequence is *readable* — lamps going out from the top of the road
  down is the emotional core of the middle game and it happens in about eight seconds.
- **Whether relighting should be free** (`D2`). Free keeps the charge on the player's attention
  rather than their wallet, and avoids a dig-out-of hole; but it also means a player who checks
  in every few minutes never really pays for overextending. The alternative — relighting costs
  a fraction of the lamp — is one number and I would try it in a player pass before defending
  free on principle.
- **Whether `uncappedSeconds = 3 h` is generous for a ten-minute game.** It is deliberately far
  above the longest night, which is the point, but it also means the demo never once exercises
  the softcap branch of `sim`'s own curve during normal play. The demo should ship a test that
  drives an eight-hour absence, because otherwise the most interesting third of `offline` is
  covered by nothing.
