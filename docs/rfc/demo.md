# LAMP ROAD — the demo game the kit must be able to build

> **Status:** design. Nothing is implemented. The build is `D1`.
> **This document is the acceptance test for the other nine RFCs.** Every beat below names
> the capability it needs and the package that owes it. A package RFC that cannot serve its
> column here is not finished, however internally coherent it is.

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

`reach` is the master variable and everything is closed form in it. There is no tick.

---

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
| 2:09 | **Second night, 24 s.** Oil goes negative partway through. The top lamp gutters with a puff of smoke, then the next, and the pilgrim line shortens in front of the player. | `sim` **solve for depletion time**; `draw`; `audio` |
| 2:54 | Third dawn. The camera pans up the ridge to a rockfall and holds. Card: *There is a shorter way.* 400 coin. | `loop` tween (camera); `ui`; `iso` camera |
| 3:10 | Rockfall cleared. **Every pilgrim on the map re-routes over the ridge**, same lamps, shorter road, and the coin rate jumps without a single purchase. | `iso` **weighted-cost path + recompute on tile change** |
| 3:27 | **Third night, 33 s.** Now longer than the run to the shrine takes. Presses matter more than lamps. Buy-max on presses is one call, not a loop. | `sim` cost closed form |
| 4:12 | Ridge lamps. The shrine's silhouette is finally inside the last lamp pool, still unlit. The card names it for the first time: *Light the shrine before the longest night.* | `ui`; `draw` text |
| 4:54 | **Fourth night, 42 s.** Longer than day. The player is now playing the actual game the first four minutes were teaching. | everything above |

Something new every 45–90 seconds, and the gap never more than doubles. The five-minute mark
is where the tutorial stops being invisible and starts being scenery.

### Session two, at 0:00

Close the tab. Come back. Before anything is tappable, one toast:

> **Two days and two nights passed.** 1,240 coin. The four highest lamps went out at 3:41 into
> the second night.

That sentence is a load-bearing test of three packages at once: `persist` for the stamped
save, `loop` for the injected clock, and `sim` for accruing across an **alternating** day/night
rate and *solving* for the moment the oil ran out rather than discovering it by ticking. If
any of the three RFCs owns none of the timestamp, that toast cannot be written.

---

## The ending

**The Longest Night**, at roughly nine to eleven minutes.

The shrine has been visible and dark since frame one. To light it the player needs two things
they have spent the whole game acquiring: an **unbroken lit path from gate to shrine**, and
enough **wicks** to hold it plus the brazier, which burns as much as six lamps.

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
| **a real v1 → v2 migration shipped in the demo**: v1 held `lampsLit: number`, v2 holds `lamps: LampId[]` because lamps became individually addressable when they started guttering out from the top | `migrate` | ✓ | the demo ships a v1 fixture and boots it. A migration chain with only one link has never been tested |
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
| **offline accrual across an alternating piecewise rate** (day rate, night rate, boundaries that move because nights lengthen) | `offline` | ✗ | returning after two days is simply wrong. This is the gap I most expect an `offline` RFC to miss, because a constant-rate warp is the obvious design and it is not enough here |
| **solve for the time a stock hits zero**, in closed form | `flow`/`capacity` | ✗ | "the far lamps went out at 3:41 into the second night" — both live and offline. Discovering it by ticking is exactly what the no-tick invariant forbids |
| offline warps time, never yield | `offline` | ✓ | — |

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
4. **`sim.offline` — piecewise alternating rates, and solve-for-depletion-time.** Two
   separate misses, both in the same module, both invisible until a player closes the tab.
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
| `rules.ts` | costs, rates, capacity, day/night schedule, objective spine | 60 | 90 | `sim` is missing capacity, cycles, or the depletion solve |
| `hud.ts` | wallet, objective card, buy buttons, toasts | 40 | 65 | `ui` is a set of parts, not a set of primitives |
| `save.ts` | v1 and v2 schemas, the migration, the offline report | 20 | 35 | `persist` needs the timestamp seam resolved |
| `sound.ts` | six sound definitions and the ambience parameter | 15 | 25 | `audio.sounds` is not declarative enough |
| **total** | | **335** | **≈500** | past 500, the kit failed, not the design |

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
