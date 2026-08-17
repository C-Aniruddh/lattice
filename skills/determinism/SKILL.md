---
name: determinism
description: Making a game produce the same result twice — same seed, same world, same pixel. Use when a replay diverges, when two runs of the same code disagree, when a world regenerates differently after panning away and back, when a saved game loads wrong on another machine or browser, or when choosing what may be written into a save file or hashed.
---

# Determinism

The claim this kit makes is that a session can be replayed from a seed and an input log and land
on the same pixel. That is a real property with real edges, and most of the ways it breaks are
things nobody would guess.

---

## Two tiers, because the language only promises one

ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise operators **exactly**. It
explicitly does *not* require `sin`, `cos`, `pow`, `exp` or `log` to be correctly rounded, so two
conforming engines may disagree in the last bit.

| | arithmetic | promise | may reach |
|---|---|---|---|
| **Tier A** | `+ - * /`, `sqrt`, `imul`, bitwise, `abs`/`min`/`max`/`floor`/`round` | bit-identical on every engine | hashes, save files, replays, anything |
| **Tier B** | `sin`, `cos`, `atan2`, `pow`, `exp`, `log` | correct to within an ulp or so | **pixels only** — never hashed, never persisted |

Tier B is not banned; a cost curve is `b · r^k` and there is no honest way around that. What it
must not do is reach a save file or a hash.

Consequences you will meet:

- **There are no sine or expo easings anywhere in the kit.** A tween drives a position, a
  position gets written to a save, and the save no longer replays.
- **Pick a dyadic offline exponent.** `0.5`, `0.625` and `0.75` are computed as a chain of
  `Math.sqrt` and multiplies, so credited time is Tier A for free. `0.6` is three per cent
  stingier than `0.625` and a whole determinism tier worse.
- **Path costs are integers** — the octile metric `14·min(dx,dy) + 10·|dx−dy|`, exact and
  admissible with no `sqrt`. Float summation is associative only by luck, so two engines can pop
  equal-cost nodes in a different order and return different — both optimal, both different —
  routes.
- **`SEMITONE` exists so a game need not call `pow`** for a musical interval.

**The one place the tier rule bites hardest is a field that feeds itself.** A height field being
eroded is state that feeds the next step, so a last-bit disagreement in one `pow` is amplified by
the next droplet that steers on the gradient it perturbed — and after a hundred thousand
iterations two conforming engines have the river in a different valley. In a loop like that, use
only Tier A arithmetic and do not bother tagging anything as presentation, because every value in
the file reaches the next iteration.

---

## Position-determinism, not sequence-determinism

This is the one that catches people building a world.

```ts wrong
import { createRng } from '@latticekit/core';

// Deterministic in the sense that a replay from tick zero reproduces it, and completely
// useless for a world you can pan around: what it produces depends on the ORDER chunks were
// reached. Pan away from a landmark and back, and you get a DIFFERENT landmark.
const rng = createRng('valley');
export function mintChunk(): number[] {
  return Array.from({ length: 256 }, () => rng.next());
}
```

```ts
import { fbm2, hash2, toUnit } from '@latticekit/core';

const SEED = 0x5eed;

/** A pure function of its coordinates. There is no cursor, so there is no draw order to get
 *  wrong — evict this chunk, come back, and it re-mints bit-identically. */
export function tileAt(gx: number, gy: number): { height: number; tree: boolean } {
  return {
    height: fbm2(SEED, gx * 0.04, gy * 0.04, 4) * 8,
    tree: toUnit(hash2(SEED ^ 0x7ee, gx, gy)) > 0.86,
  };
}
```

**An `Rng` is a stream: draw order matters. A hash is a function of its coordinates: draw order
cannot matter, because there is no draw.** Use a stream for a sequence of decisions the game
makes in a fixed order, and a hash for anything addressed by position.

When you do want a stream, fork it by **identity**:

```ts
import { createRng } from '@latticekit/core';

const world = createRng('valley-3');
export const trees = world.derive('scenery');
export const names = world.derive('names');
```

`derive` forks from the stream's identity, never its cursor, so `trees` produces the same
sequence no matter how many times `names` was drawn from first — which is what stops a valley
quietly reshuffling itself when a player does things in a different order. There is deliberately
**no global `Rng`** and no module-level mutable state anywhere in `core`.

---

## What may reach a save file

A short list, and each row has cost somebody a bug.

| never persist | persist instead | because |
|---|---|---|
| a `#rrggbb` derived from a hue | the **hue** | derivation needs `cbrt` and `pow` — a stored token is an engine-specific artifact in a file that will travel |
| a price | the **curve's parameters** | the curve is the durable thing; a price is a fact about one build |
| the result of `maxBuyable` | nothing — recompute it | at an exact boundary two engines can differ by one unit bought. It is advisory |
| `Infinity` | a finite number, or refuse | it serializes to **`null`, under a valid checksum**, and comes back as `NaN` on the next tick |
| a recomputed state hash | the **bytes** you read | a checksum must cover what was read, not what you think it meant |
| a duration accumulated on the fixed step | a **timestamp** | `loop.time` deliberately drifts below real time while hidden |

**Never hash or equality-compare a stock vector.** Compare with a relative tolerance of 1e-9.

**`hashString` walks UTF-16 code units**, so text a human typed must be `.normalize('NFC')`-ed
before hashing or the same visible name produces two different keys on macOS and Windows — and
the bug reproduces on nobody's machine. But never normalize a *payload* you are checksumming: the
bytes are the subject, and a save truncated mid-combining-sequence must fail.

---

## Running a replay

```ts
import { replay } from '@latticekit/loop';
import type { ReplaySource } from '@latticekit/loop';

interface Game {
  update(dt: number, tick: number): void;
  hash(): number;      // Tier A arithmetic only
}

export function verify(source: ReplaySource, game: Game): number {
  const result = replay({
    source,
    update: (dt, tick) => game.update(dt, tick),
    hash: () => game.hash(),
  });
  return result.divergedAt;    // -1 when this build still agrees with the recording
}
```

`ReplaySource` is structural rather than imported — `{ ticks, stepMs?, applyAt(tick),
checkpointAt(tick) }` — so `loop` never reaches sideways to `persist`, and an array in a test
satisfies it just as well as a stored log.

**What a green replay proves.** That the fixed step's prohibitions were obeyed. A game that reads
a clock inside `update`, derives from a frame delta, or lets a render pass mutate state cannot
pass, because none of those inputs exist here — there is no wall clock, no variable delta, and
nothing is painted. It is the one test that fails when someone adds `Math.random()` to a system
months from now.

**What it does not prove.** Not the picture. Input runs two clocks — gestures deliver on ticks,
the camera integrates on frames — so a log reproduces the same world and the same tiles, not the
same glide. The rule that keeps that safe is the tier rule: a frame-integrated camera may reach
pixels and must never reach a hash. And a replay is not a save: it reconstructs a session from
its start, it does not resume one.

**`result.checkpoints === 0` means the log carried none and the run proved very little.** Check
that before believing a `-1`.

---

## The three things a replay is checked against, and the one that is not there

`persist`'s verifier compares `kit`, `game`, `inputs.version`, `inputs.stepMs` and
`inputs.profile` for exact equality before the first tick, and names the one that differed.

**A gesture profile is part of a replay's identity.** The same finger movements under a tap slop
of 8 px and of 12 px are a different sequence of actions.

**The action map is deliberately *not* in that triple** — which is why `setActions` refuses while
a recording is open. A mid-recording rebind changes nothing about what the log *says* and
everything about what a replay of it *does*, behind a triple that still matches exactly, so
nothing downstream could refuse it and the replay would report a divergence that is confidently
wrong.

**`stepMs` is a compatibility constant.** Changing `hz` in a shipped game is a breaking change to
every recorded session, exactly as changing a save schema is, and it belongs in a migration note
rather than in a tuning pass. A log recorded at 60 Hz replayed at 50 Hz produces a confident
wrong answer, which is worse than a refusal — so it is refused by name.

**A replay log is never migrated.** A save is progress; a replay is evidence, and evidence that
has been migrated is no longer evidence.

---

## Finding a divergence, fastest first

1. **Is it a divergence at all?** Check `divergedAt` against `checkpoints`. Zero checkpoints
   means the log proved nothing; a refusal by name means the log and the build disagree about
   what they are, not about what happened.
2. **`lastAgreedTick` and `divergedAt` bracket the bug.** Everything before the first is
   identical. The cause is between them, and usually at the second.
3. **Grep for the four bans**, in this order: `Math.random`, `Date.now`, `performance.now`, and
   anything reading a frame delta inside `update`. Three of those cannot appear in kit code at
   all, so any hit is yours.
4. **Grep for the transcendentals** — `sin`, `cos`, `pow`, `exp`, `log`, `atan2` — and ask of
   each whether its value reaches the hash. Most will not. The one that does is the bug.
5. **Look for a stream where a hash belonged.** If the divergence follows the player doing things
   in a different order rather than a different *amount*, it is draw order, and the fix is
   `hash2(seed, gx, gy)`.
6. **Check a fresh process, not just twice in one.** Two runs inside one process share module
   state that a second process does not.

---

## Things that look like a divergence and are not

- **A `0.0 ms` frame readout.** The tab is hidden. Nothing is diverging; nothing is running.
- **A stock vector differing in the sixteenth significant figure** after a player moved from
  Firefox to Safari mid-run. That is the offline warp, it is Tier B, and it is documented.
- **`Infinity` becoming `null`.** That is JSON, not arithmetic.
- **`noise2` returning exactly zero.** It does, on 397k of 14M samples — but only when **both**
  inputs are lattice points. If your code assumes noise is never exactly zero, it is a live bug on
  integer coordinates and not a platform difference.
- **`hash2` truncating toward zero rather than flooring**, so cells `-0.5` and `0.5` share cell
  `0`. Anything sampling across the origin must floor first.

---

## What this skill does not cover

| you want | read |
|---|---|
| the loop, and where a clock may be read | `starting` |
| generating a world from a seed | `world` |
| what may and may not be stored | `saving`, `economy` |
| recording the input log in the first place | `input` |
| why a green suite is not evidence of a working game | `performance`, and the `/lattice` flow's rule about looking at it |
