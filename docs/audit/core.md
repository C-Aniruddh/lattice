# Audit — `@latticekit/core`

Task C1. Adversarial, not a code review: the object was to break the promises the package makes
about itself and report what held.

Everything below was run against `packages/core/dist` on Node 24 / V8 / darwin-arm64. Probe scripts
were throwaway and are not in the repo; every finding carries the snippet that reproduces it.

**Nine findings: 0 high, 2 medium, 7 low.** One of the low ones (CORE-8) is not a defect in `core`
at all — it is a hole in the linter that guards `core`'s central rule, and it routes out.

---

## What was attacked

The five invariants in `.lattice/kit.json`, and the claims each module's header makes about itself.

| claim | attacked with | verdict |
|---|---|---|
| Zero dependencies, zero DOM | read of every import in `src/` | held |
| Tier A is bit-identical | JSON round trip of `RngSnapshot`, path composition of `derive`, uint32 containment of every intermediate | held *on one engine* — see "what could not be tested" |
| Tier B declares itself | grep of every `Math.*` site against `tools/lint.mjs`'s rule | **broken — CORE-8** |
| No module-level mutable state | read of every top-level binding | held |
| Sub-streams fork from identity, not cursor | `derive` after 0 and after 10^6 draws | held |
| Validators return their argument and name the value | every guard, with `NaN`, `Infinity`, `-0`, `2^53`, `1e21`, `''`, `null`, an array, a string | held, with two message defects (CORE-4, CORE-7) |
| The hot path allocates nothing | out-parameter aliasing on all of `vec2`; pool exhaustion and foreign release | shape held, bookkeeping did not — CORE-3 |
| Options are readable back (non-negotiable 11) | `PoolOptions` | **broken — CORE-2** |
| Errors name the caller's mistake (non-negotiable 9) | every throw site | **broken — CORE-4** |

---

## Findings

### CORE-1 · medium · `rng.float` produces exactly the value its own guard exists to prevent

`Rng.float`'s doc says:

> `@throws RangeError` unless both bounds are finite and `max >= min`. An infinite bound would
> produce `Infinity` or `NaN`, and `JSON.stringify` writes both as `null` — a value that vanishes
> from a save with the checksum still matching.

Both bounds being finite is not enough. The quantity that has to be finite is the **span**.

```js
import { createRng } from '@latticekit/core';

createRng('x').float(-Number.MAX_VALUE, Number.MAX_VALUE);  // => Infinity
createRng('z').float(-1e308, 1e308);                        // => Infinity
```

`expectFinite(min)` and `expectFinite(max)` both pass; `max - min` overflows to `Infinity`, and
`min + next() * Infinity` is `Infinity` for every draw — except a draw of exactly `0`, where
`0 * Infinity` is `NaN`:

```js
// the arithmetic rng.float performs, with a draw of exactly 0 (probability 2^-32 per call):
-Number.MAX_VALUE + 0 * (Number.MAX_VALUE - -Number.MAX_VALUE);   // => NaN
```

**Consequence.** A check that passes when it should fail, in the package that owns determinism, on
the value the guard's own prose names as the one that vanishes from a save with a valid checksum.
`persist` will write it as `null` and report `written: true` (see `docs/audit/persist.md`,
PERSIST-2).

**Honest severity.** No game coordinate is within 300 orders of magnitude of this, and I found no
call site in the kit that can reach it. It is medium rather than low only because the guard is
*specifically* the one that claims to close this door, and because the fix is one line
(`expectFinite(max - min, 'rng.float(max - min)')`).

---

### CORE-2 · medium · non-negotiable 11: `PoolOptions` is write-only

Five options go into `new Pool({ … })` and none of them comes back out.

```js
import { Pool } from '@latticekit/core';

const p = new Pool({ create: () => ({}), max: 512, checked: true, initial: 64 });
'max' in p;      // false
'checked' in p;  // false
'initial' in p;  // false
Object.getOwnPropertyNames(Object.getPrototypeOf(p));
// [ 'constructor', 'size', 'free', 'acquire', 'release', 'preallocate' ]
```

`size` and `free` are *derived* counters, not the options. Nothing reads back `max`, `checked`,
`initial`, `create` or `reset`.

**Consequence.** Exactly the shadow copy non-negotiable 11 exists to remove. A debug overlay that
wants to draw "particles: 312 / 512" has to hold its own copy of `512`, and a tuning panel that
raises the ceiling has to rebuild the pool *and* remember the new number itself, because the pool
will not tell it. This is the same defect already filed as K14 (`iso` camera), K18 (`audio`), K19
and K34 (`draw`) — `core` has it too, and `core` is the package every one of those sits on.

**Settability**, per the rule's own three-part test: `max` is a **cost** value read on the acquire
path — bake what it derives, never the option; but reading it back is free and unconditional. That
is the half of the rule that has no counter-argument.

---

### CORE-3 · low-medium · `Pool.release` accepts an object the pool never made, and the bookkeeping then lies

`release` pushes whatever it is handed onto the free list without asking where it came from.
`#created` is not incremented, so both public counters go wrong at once.

```js
import { Pool } from '@latticekit/core';

const p = new Pool({ create: () => ({ tag: 'own' }), max: 2 });
const a = p.acquire(), b = p.acquire();
p.release(a); p.release(b);
p.release({ tag: 'foreign' });          // never came from this pool

p.size;            // 2
p.free;            // 3
p.size - p.free;   // -1  — "how many are out", per the doc on `free`

[p.acquire().tag, p.acquire().tag, p.acquire().tag];
// [ 'foreign', 'own', 'own' ]  — three instances out of a pool whose max is 2
```

**Consequence.** `max`'s doc says exceeding it "throws rather than growing, because a pool that
grows without bound has become a slower `new` with extra steps". A single foreign release raises the
real ceiling silently and permanently, and `size` — the number the doc tells you to "watch flatten"
to find a leak — stops counting what is in circulation. `checked: true`, whose doc calls the bug it
catches "the single nastiest bug this module can cause", does not catch this one: `indexOf` finds
nothing because the foreign object is not yet on the free list.

**Honest severity.** It is caller discipline, and the module says so out loud ("A released instance
must not be touched again. The pool cannot enforce that"). What it does not say is that a *wrong*
release corrupts the counters rather than being ignored. Low-medium because the symptom — a pool
that quietly stops honoring `max` — presents nowhere near the release that caused it.

---

### CORE-4 · low · non-negotiable 9: the `Pool` constructor names a method the caller never called

```js
new Pool({ create: () => ({}), initial: -1 });
// RangeError: pool.preallocate: expected a non-negative integer count, got -1

new Pool({ create: () => ({}), max: 2, initial: 5 });
// RangeError: pool.preallocate: 5 more instances would exceed capacity 2 (0 already created)
```

The caller wrote `initial`. The word `initial` appears nowhere in either message, and
`preallocate` appears nowhere in their code. Constructor validation for `create` and `max` is
written out in the constructor and reads correctly (`pool: expected \`max\` to be …`); `initial` is
the one that is delegated, and the delegation leaks the callee's name.

**This one is currently defended by a test.** `packages/core/test/pool.test.ts:184` asserts the
message verbatim:

```ts
expect(() => pool.preallocate(-1)).toThrow(
  'pool.preallocate: expected a non-negative integer count, got -1',
);
```

That assertion is correct for a direct `preallocate(-1)` call. The constructor case is covered two
tests later by `toThrow(RangeError)` alone, with no message assertion — so the wrong label is
untested where it is wrong and pinned where it is right. Any fix must add a label parameter rather
than change `preallocate`'s own message.

---

### CORE-5 · low · `rng.weighted` overflows its total silently and always returns the last row

The guard checks every weight is finite and non-negative; it never checks the **sum**.

```js
import { createRng } from '@latticekit/core';

const r = createRng(1);
Array.from({ length: 20 }, () => r.weighted([1e308, 1e308, 1e308]));
// [ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2 ]
```

`total` saturates to `Infinity`, `target = next() * Infinity` is `Infinity`, every
`target < accumulated` test is false, and the function falls through to `return last`. Three equal
weights, one outcome, forever. (With a draw of exactly `0`, `target` is `NaN` and the result is the
same index for a second reason.)

**Consequence.** A deterministic wrong distribution, which is worse than a non-deterministic one
because it will never be caught by a repeated run. The doc enumerates three throw conditions —
empty, negative or non-finite entry, sums to zero — and "sums *above* the finite range" is the
fourth that is missing. An idle economy is the genre where a 1e308 number is not absurd, and this
kit's `sim` module explicitly declines to cap measured quantities ("`1e40` is a perfectly good
double").

**Honest severity.** Low. I could not construct a weight table in this repo that reaches it.

---

### CORE-6 · low · the `-0` defense is applied in two places and skipped in the five that produce one

`core` takes `-0` seriously in three separate comments, each naming the same failure:

- `noise.ts` `unsignZero`: "a heightfield persisted and reloaded would then differ from the one
  that was saved, and an integrity comparison would fail for a reason nobody would ever find";
- `vec2.ts` `v2Perp`: `0 - ay`, not `-ay`, for the same reason, "Axis-aligned edges are most of
  them in a tile game";
- `guard.ts` `expectSerializable`: normalizes `-0` to `0`.

The defense is not applied where `-0` is actually produced:

```js
import { v2, v2Scale, v2Lerp, lerp, moveTowards, clamp } from '@latticekit/core';

const out = v2();
v2Scale(out, { x: 0, y: 0 }, -1);
Object.is(out.x, -0);              // true   — reflecting a zero velocity on a bounce
Object.is(lerp(-0, -0, 1), -0);    // true
Object.is(moveTowards(0, -0, 1), -0);  // true
Object.is(clamp(-0, -5, 5), -0);   // true
Object.is(v2Lerp(v2(), { x: -0, y: -0 }, { x: -0, y: -0 }, 0.5).x, -0);  // true

JSON.stringify(-0);                // "0"
```

**Consequence.** A value written to a save as `-0` reads back as `0`. `hashNumber(-0) ===
hashNumber(0)`, so a *hashed* digest is unaffected — the damage is confined to `Object.is` and
strict-equality comparisons, and to `persist`, which never calls `expectSerializable` at all
(PERSIST-2). Low, and named here mainly because a defense applied in two of seven places reads to
the next author as a defense that is not needed.

---

### CORE-7 · low · `expectRange`'s message claims a check it does not perform

```js
import { expectRange } from '@latticekit/core';
expectRange(Infinity, -Infinity, Infinity, 'terrain.height');   // => Infinity, no error
```

The message this guard prints when it *does* fire reads `expected a finite number in [min, max]`.
It never checks finiteness; with finite bounds the range comparison rejects the infinities as a side
effect, and with infinite bounds nothing does. Cosmetic unless a caller reads the message as the
contract — which is the failure mode `guard.ts`'s own header argues about at length.

---

### CORE-8 · low, and it routes out of `core` · the Tier B linter cannot see the operator form of `pow`

`tools/lint.mjs`'s Tier B rule is one regex:

```js
/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh)\b/
```

`a ** b` is `Number::exponentiate`, which ECMA-262 defines as *implementation-approximated* —
identical standing to `Math.pow`. It matches nothing. Neither do `Math.expm1`, `Math.log1p`,
`Math.asinh`, `Math.acosh` or `Math.atanh`.

```js
const re = /\b(Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh))\b/;
re.test('const y = Math.pow(b, k);');   // true
re.test('const y = b ** k;');           // false
re.test('const y = Math.expm1(x);');    // false
```

**There is a live undeclared Tier B site today.** `packages/audio/src/voice.ts:84`:

```ts
return semitones === 0 ? hz : hz * SEMITONE ** semitones;
```

It is in `audio`, where the value is a frequency and never reaches a save, so the *consequence* is
nil. The *rule* is not: AGENTS.md says the marker exists "so that every one of them is greppable, so
an auditor can ask of each in turn whether it ever reaches a save file". This one is not greppable
by the mechanism the constitution names, and I only found it by writing a second scanner. A rule
whose enforcement has a hole is a rule that is followed until the first hurry.

**Routing.** `tools/lint.mjs` plus `packages/audio/src/voice.ts` — both outside this audit's paths.
Filed as a task.

---

### CORE-9 · low, theoretical · `Emitter` disposers are matched by value, so a later one removes an earlier one

`Emitter.#remove` uses `indexOf`, so the disposer returned by the *third* `on(event, f)` removes the
*first* registration of `f`:

```js
import { Emitter } from '@latticekit/core';

const e = new Emitter();
const seen = [];
const f = () => seen.push('f');
const g = () => seen.push('g');

e.on('x', f);
e.on('x', g);
const off3 = e.on('x', f);
off3();                       // disposes the third registration…

e.emit('x', undefined);
seen.join(',');               // 'g,f'  — the first registration was the one removed
```

The module promises dispatch "in registration order". After this, `f` runs after `g` rather than
before. Because `f` is literally the same function object in both slots the *effect* is identical,
so this is theoretical — but the header states the ordering as a property a replay can depend on,
and the property is now "in registration order, modulo duplicates". `on`'s doc addresses the
adjacent case (disposing twice must not remove a later listener) and not this one.

---

## What held up best under attack

Worth recording, because most of it is load-bearing for the rest of the kit.

- **The `Rng` contract.** `snapshot()` → `JSON.parse(JSON.stringify(…))` → `fromSnapshot()` resumes
  the identical draw. `derive('a').derive('b')` and `derive('a', 'b')` produce the same seed.
  `derive` after 10^6 draws produces the same child as `derive` after zero. `int` refuses every
  span above 2^32 including `1e21` and `2^53 - 1`, and a span of exactly 2^32 never rejects a draw.
- **Every easing satisfies `e(0) === 0` and `e(1) === 1` under `Object.is`** — all thirteen, and
  both combinators preserve it for all thirteen. `bounceOut` measured over 10^6 samples stayed in
  `[0, 1]` inclusive with both endpoints touched, as its doc claims. This is the sort of arithmetic
  claim that is usually approximately true; here it is exactly true.
- **`noise2` and `noise3` stayed inside `[-1, 1]`** over 300,000 samples at random seeds and random
  fractional coordinates (measured extremes: `-0.993 … 0.990` in 2D, `-0.755 … 0.806` in 3D). The
  `unsignZero` defense is real: lattice points return `+0` under `Object.is`, and it is pinned by a
  `toBe(0)` test that would fail on `-0`.
- **`hashString` produced zero collisions over 200,000 sequential keys.** `hashBytes` is sensitive
  to trailing zeros; `hashParts` is non-commutative; `hashNumber` keeps the high bits above 2^32.
- **Every `vec2` out-parameter function is aliasing-safe.** Checked exhaustively for
  `v2Add`, `v2Sub`, `v2Lerp`, `v2AddScaled` (out aliased to each of the two inputs in turn, results
  compared against the un-aliased case) and for `v2Normalize`, `v2Perp`, `v2Rotate`, `v2Copy` with
  `out === a`. The module's stated rule — read every component into a local before writing one —
  is followed everywhere it matters.
- **`Scope`.** Reverse registration order across a nested child, idempotent `dispose`, every
  disposer still runs when an earlier one throws, and the `AggregateError` names the count. A child
  created on an already-disposed scope comes back already disposed.
- **`fmtCompact` held its six-character bound** across roughly 1.4 million evaluations — every power
  of ten from 1e-320 to 1e308, `±9.99e±n` at every exponent, 200,000 random magnitudes, and the
  documented boundary cases, each at all seven legal `decimals` values. Not one output exceeded six
  characters.

---

## What I could not test, and why

An audit that claims full coverage is lying. These are the gaps.

1. **Cross-engine bit-identity — the central Tier A claim — was not tested at all.** Everything ran
   on one V8 build. A single-engine run cannot falsify "bit-identical on every conforming engine";
   it can only fail to contradict it. The argument that it holds is *textual* — the code uses only
   `Math.imul`, `>>>`, `^` and division by 2^32 — and I verified that reading, but the claim itself
   remains unverified by execution. Testing it needs a second engine (SpiderMonkey or
   JavaScriptCore) running the same fixture and comparing digests, which is a real piece of CI this
   repo does not have.
2. **Non-negotiable 7 was audited as a *shape*, not as a *measurement*.** I confirmed by reading
   that `math`, `vec2`, `hash` and `Emitter.emit` contain no object literal, array literal or
   closure, and confirmed the aliasing contract by execution. I took no heap profile, so "allocates
   nothing" is an argument from source, not from a measurement. The existing `*.bench.ts` measure
   throughput, which is not the same question.
3. **`Rng.derive`'s label space.** I verified path composition and identity-not-cursor forking. I
   did not probe for collisions across a large label space — a 32-bit seed has a birthday collision
   at ~77,000 distinct sub-streams, which is a number a large game could reach, and I have no
   measurement of how close anything gets.
4. **The coverage floors** (90 % statements per package, 100 % on `core`) were not re-measured. I
   read tests looking for assertions that cannot fire and found one *defensive* case (CORE-4); I did
   not run the coverage tool.
5. **`fmtDuration` and `fmtCompact` against a screen.** Locale-freedom and width are verified as
   string properties. Whether the results are *readable* is non-negotiable 10's question and needs
   someone looking at the demo.

---

*Findings worth acting on are filed in `.lattice/tasks.json` as `L1`–`L7`. CORE-7 and CORE-9 are
recorded here and deliberately not filed: one is a message that is cosmetically wrong and the other
has no observable effect.*
