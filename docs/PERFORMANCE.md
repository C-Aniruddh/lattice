# Performance

Numbers, not convictions. Every claim in the kit's documentation about speed should be
traceable to a row in this file, and every row should be reproducible with `npm run bench`.

**Machine:** Apple Silicon, Node v24.18. Vitest `bench`, which reports throughput (`hz`) and a
latency distribution per operation. Inputs are cycled through a 1,024-entry table so nothing
is loop-invariant and V8 cannot hoist the work out of the loop.

**Budget:** 8 ms per frame for everything, from `.lattice/kit.json`.

---

## The allocation question, and what the benchmark actually said

The kit's rule 7 — *the hot path allocates nothing* — costs something real: every vector
signature takes an output parameter, so every call site is two characters longer and the
caller has to own a scratch value. That is worth paying only if the alternative is worse.

The naive way to check is to compare mean throughput, and **by that measure the rule looks
wrong.** Allocating is not slower:

| operation | ops/sec | rme | max latency |
|---|---:|---:|---:|
| allocating add, result escapes | 50,709,067 | ±0.91% | **2.3168 ms** |
| out-parameter add, identical work | 40,714,999 | ±0.06% | **0.0274 ms** |
| `v2()` — the allocator alone | 38,616,663 | ±0.88% | 2.2308 ms |

The allocating form wins on throughput by about 25%, and that is not a measurement error —
V8's nursery is a bump allocator, and an object that dies in the same iteration is close to
free to create and free to collect.

**Look at the last column.** The allocating form's worst observed call is **85× slower** than
the out-parameter form's, and its variance is 15× higher. That is the garbage collector,
showing up exactly where a mean cannot see it. A 2.3 ms pause inside an 8 ms budget is not a
slow frame; it is a dropped one, and it arrives in a burst rather than spread evenly, so the
player sees a hitch rather than a lower frame rate.

So the rule stands, but **not for the reason it is usually given.** Out-parameters are not
faster on average. They convert a small, occasional, unpredictable cost into no cost at all,
and the thing a game is protecting is its frame-time tail, not its mean. Anyone tempted to
relax the rule because "allocation is cheap now" is right about the mean and wrong about the
only number that matters.

Corroborating: 3M out-parameter calls with a forced GC either side retain **~4.6 kB**, which
is measurement noise. There is nothing for a collector to do.

---

## `@lattice/core`

### vec2 — the per-entity path

| operation | ops/sec | ns/op | notes |
|---|---:|---:|---|
| `v2Perp` | 42,620,759 | 23.5 | |
| `v2AddScaled` | 42,033,785 | 23.8 | |
| `v2Add` | 41,993,039 | 23.8 | |
| `v2Rotate` | 41,297,658 | 24.2 | **Tier B** — `sin`/`cos`, presentation only |
| `v2Lerp` | 40,694,002 | 24.6 | |
| `v2Normalize` | 40,381,007 | 24.8 | two divisions, not a reciprocal multiply — `3 * (1/5)` is `0.6000000000000001` and `3/5` is `0.6`, and both are Tier A |
| `v2Dot` | 37,518,681 | 26.6 | returns a scalar, so allocates nothing by construction |
| `v2Len` | 37,036,077 | 27.0 | |

The ns/op figures include the harness's per-iteration overhead and a table lookup, so they
are an upper bound on the operation itself; the *ratios* are the meaningful part.

### rng and hash — the per-tile path

| operation | ops/sec | notes |
|---|---:|---|
| `mix32` | 37,875,442 | fmix32 avalanche |
| `hashStep` | 35,711,376 | the fold `hash2` and `hash3` are built from |
| `hash2` | 33,364,528 | one per visible tile per frame |
| `hashString` (short key) | 31,219,018 | |
| `hash3` | 30,825,261 | one per track per step in the audio deck |
| `noise2` | 14,763,965 | gradients from a fixed direction table, no `sin` |
| `fbm2`, 4 octaves | 3,729,100 | 3.96× `noise2`, which is the expected cost of four lookups |

**Stateless hashing costs almost nothing against a stream.** That matters more than the raw
number: `hash2` depends only on its coordinates, so a renderer may visit tiles in any order
and get the same field, while an `Rng` stream depends on how many draws came before it. If
the hash had been meaningfully slower, that correctness property would have needed arguing.
It is within 12% of `mix32`, so it does not.

### Frames

| workload | per frame | share of the 8 ms budget |
|---|---:|---:|
| 400 sprites × 3 vector ops (1,200 ops) | 12.8 µs | **0.16%** |
| 2,400 terrain tiles, one `hash2` each | 22.9 µs | **0.29%** |

Both are the realistic per-frame load for their subsystem, and together they are under half a
percent of the budget. The interesting consequence is that **vector maths and terrain hashing
are not where an isometric game's frame time goes** — the draw calls are. Optimising either
of these further would be optimising the wrong thing, and this table exists partly so nobody
does.

---

## Method notes

- **p50 and p99, never a mean alone.** A mean hides precisely the frame that stutters, which
  is the one a player notices. The allocation table above is the whole argument for this.
- **Fixed seeds.** Every benchmark drives its inputs from a seeded `Rng`, so the workload is
  identical between runs and a change in the number is a change in the code.
- **The machine is named**, because a number without one is not reproducible.
- **Regressions stay in the table.** A row that got worse is more useful than a row that
  quietly disappeared.

---

## `@lattice/sim`

The economy's whole design rests on closed form rather than iteration, so these numbers are
the argument for it rather than a report on it.

| operation | time | notes |
|---|---:|---|
| `costOfNext` | ~52 ns | |
| `maxBuyable` | ~210 ns | **O(1)**, and 12× a 400-step buy loop — the loop is legitimate only as a test oracle |
| `buildFlow` | ~90 ns | |
| `integrate` — fourteen hours in one step | ~485 ns | the step size does not appear in the cost, which is the point |
| `project` | ~510 ns | |
| `solveCrossing` — degree 1 | ~330 ns | |
| `solveCrossing` — degree 4 | ~920 ns | derivative isolation plus bisection |
| `advanceOver` — a 20-hour absence, 1,646 phases | 0.93 ms | |
| `advanceOver` — a **six-month** absence | 1.12 ms | |

The last two rows are the whole thesis in two lines. Six months costs 20% more than twenty
hours, and only because the longer absence credits the full 24-hour horizon — the *duration*
is not in the complexity at all. A tick-based economy would have needed 15.7 million steps
for that row.

## `@lattice/loop`

| path | rate | per call |
|---|---:|---:|
| idle pump, no subscribers | 26.9 M/s | ~37 ns |
| pump: 1 step, 1 update, 1 render | 10.6 M/s | ~94 ns |
| pump: 32 update + 32 render subscribers | 2.87 M/s | ~348 ns |
| full catch-up pump (14 steps, then the clamp) | 2.47 M/s | ~405 ns |
| `timeline.advance`, 64 timers all due | 1.11 M/s | ~904 ns |
| `tweens.step`, 200 live tweens | 826 k/s | ~1.21 µs (~6 ns/tween) |
| `replay`, 10,000 ticks | — | **~11.2 M ticks/s** |

The loop's own share of an 8 ms budget is about **0.005%**. The replay figure matters for a
different reason: verifying an hour of recorded play takes under a third of a second, so a
divergence check is something CI can run on every commit rather than a thing anyone schedules.

## `@lattice/audio`

Measured with no device, which is the honest way to measure the policy layer — it is the half
that runs on every call whether or not a speaker exists.

| operation | rate | per call |
|---|---:|---:|
| `play`, dropped by the throttle | 39.1 M/s | ~26 ns |
| `bed.set`, unchanged figures | 13.2 M/s | ~76 ns |
| `deck.pump`, per step | 10.0 M/s | ~100 ns |
| `bed.set`, new figures | 8.6 M/s | ~117 ns |
| `play`, accepted | 7.1 M/s | ~141 ns |

A rejected `play` is 5× cheaper than an accepted one, which is the right shape: the throttle
exists precisely for the case where a game fires the same sound forty times in a frame.

## `@lattice/persist`

| operation | rate |
|---|---:|
| `autosave.tick` on a non-writing frame | 36.4 M/s |
| `Recorder.mark` on a non-checkpoint tick | 54.4 M/s |
| `ReplayVerifier.mark` on a non-checkpoint tick | 56.9 M/s |
| `encode` — 20 buildings / 400 buildings | 344 k/s / 7.7 k/s |
| `decode` — 20 buildings / 400 buildings | 294 k/s / 18.8 k/s |

The first three are the ones that run every frame, and all three are effectively free. The
encode/decode figures are per *save*, which happens every few seconds at most.
