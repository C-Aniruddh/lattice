# @latticekit/core

> Deterministic primitives. Seeded randomness, stateless hashing, noise, maths, easing,
> vectors, typed events, pools, lifetimes, validation and formatting.

Layer 0 of **[Lattice](https://github.com/plausibleventures/lattice)**. Zero dependencies, zero DOM,
runs unchanged in Node. Everything else in the kit is built on this package, and this package
is built on nothing.

```bash
npm i @latticekit/core
```

```ts
import { createRng, hash2, v2, v2AddScaled } from '@latticekit/core';

const rng = createRng('valley-3');
const trees = rng.derive('scenery'); // a sub-stream — see below, this is the important bit

const shade = hash2(1, 12, 7); // the same tile always gets the same color
const pos = v2(0, 0);
v2AddScaled(pos, pos, v2(1, 0), 3); // writes into `pos`; allocates nothing
```

---

## The two things worth knowing before anything else

### 1. Determinism has two tiers, because the language only promises one

ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise operators **exactly**. It
explicitly does *not* require `sin`, `cos`, `pow`, `exp` or `log` to be correctly rounded, so two
conforming engines may disagree in the last bit.

| | arithmetic | promise | may reach |
|---|---|---|---|
| **Tier A** | `+ - * /`, `sqrt`, `imul`, bitwise | bit-identical on every engine | hashes, save files, replays, anything |
| **Tier B** | `sin`, `cos`, `pow`, `exp`, `log` | correct to within an ulp or so | pixels only — never hashed, never persisted |

Tier B is **four symbols and five call sites** in this package: `damp`, `v2Rotate`, `v2Angle`,
`v2FromAngle`. Every one is marked `@tier-b`, a test greps the source and fails if a sixth
appears or one loses its marker, and the linter rejects a transcendental anywhere else in
`core` outright — an escape hatch anyone can write for themselves is not a rule.

This decides things you might otherwise trip over. There are **no sine or expo easings** in the
kit. Noise gradients come from a fixed direction table rather than the usual
`sin(hash) * 43758` shader idiom.

And one thing Tier A does *not* promise: **a round trip through JSON.** `Infinity` is a
perfectly Tier A arithmetic result and is exactly the value that does not survive being written
down — it serializes to `null`, under a valid checksum, so nothing downstream can detect it.
That is what `expectSerializable` and `isSerializable` are for.

### 2. Sub-streams fork from identity, not from position

```ts
const world = createRng('valley-3');
const trees = world.derive('scenery');
const names = world.derive('names');
```

`derive` forks from the stream's **identity**, never its cursor. So `trees` produces the same
sequence no matter how many times `names` was drawn from first — which is what stops a valley
quietly reshuffling itself when a player buys a lamp in a different order. The usual convention
("just pass a fresh `Rng` everywhere") relies on nobody forgetting; this makes the mistake
unavailable.

There is deliberately **no global `Rng`** and no module-level mutable state anywhere in this
package.

---

## `hash*` is not `rng`, and the difference is the point

An `Rng` is a *stream*: draw order matters. A hash is a *function of its coordinates*: draw
order cannot matter, because there is no draw.

```ts
hash2(seed, x, y); // the same tile, the same value, whatever order tiles are visited in
```

Four packages asked for this independently — `persist` for checksums, `iso` for per-tile
scramble, `audio` for sequencer rolls, `draw` for cache keys — which is why `hash` is its own
module and not a corner of `rng`. **Do not fold it back in.** That proposal will arrive
sounding like tidying.

`hash2` and `hash3` are `hashStep` unrolled, so a fourth axis is
`hashStep(hashStep(hashStep(hashStep(seed, a), b), c), d)` — still one expression, still no
allocation. That is the mechanism that makes `hash4` unnecessary rather than merely discouraged.

Two traps, both documented at the source: `hash2` **truncates toward zero rather than
flooring**, so cells `-0.5` and `0.5` share cell `0` and anything sampling across the origin
must floor first; and `hashString` walks **UTF-16 code units**, so a player-authored name should
be `.normalize('NFC')`-ed before hashing or it checksums differently on macOS and Windows.

---

## `Vec2` is mutable, and `Readonly<Vec2>` is not what you want

Every hot-path API in the kit takes an output parameter, so `Vec2` is mutable by design.

**`readonly` is not a barrier.** TypeScript ignores property `readonly` modifiers when checking
assignability, so two interfaces differing only in `readonly` are mutually assignable — and a
`Readonly<Vec2>` flows happily into a parameter typed `Vec2`, where the callee writes to your
frozen constant. This package builds a real barrier instead, with a phantom optional property
whose types conflict in exactly one direction. It erases at runtime and costs nothing.

```ts
import type { ReadonlyVec2 } from '@latticekit/core';

function lengthOf(a: ReadonlyVec2): number {
  /* … */
}
```

**Import `ReadonlyVec2` for read parameters. Never hand-write `Readonly<Vec2>`** or a local
`{ readonly x, readonly y }` and assume it is the same thing. Note also that
`Object.freeze(v2(0, 0))` *infers* `Readonly<Vec2>` — the explicit annotation is the entire
protection.

This claim survived ten design documents, a compile of the whole surface and a review, and was
falsified only when someone tried to make the compiler enforce it.

---

## `guard` validates, it does not assert

```ts
this.zoom = expectRange(zoom, 0.25, 8, 'camera.zoom');
// camera.zoom: expected a finite number in [0.25, 8], got -1
```

There is no `assert(cond, msg)` here, deliberately. **A boolean has already discarded the value
that was wrong**, so its message can only ever be prose — and `assert` is the exact call shape
build tools strip in production, so the check would run only where it is least needed. A
validator that returns its argument cannot be stripped, because the call site does not compile
without the result.

The house split: `TypeError` for the wrong *kind* of value, `RangeError` for the wrong *value*
of the right kind.

These run at construction and at API entry points. They deliberately do **not** run per frame
or per entity — a guard inside a per-sprite loop is a measurable cost for a mistake a caller
makes once.

---

## `Scope` is the kit's one teardown vocabulary

```ts
const scope = createScope();
scope.add(() => clearInterval(id));
const child = scope.child();
scope.dispose(); // children first, then parents, in reverse registration order
```

Five packages had invented five disposal shapes before this existed; it deleted a sixth as it
landed, because `events` had been growing its own `Unsubscribe` inside `core`. One ordering
rule, not two: `child()` registers the child's `dispose` into the parent's list, so "children
before parents" falls out of "reverse registration order" instead of being a second thing to
remember. Disposing twice is safe, and a disposer that throws does not abandon the rest —
failures are collected and rethrown together after everything has run.

---

## The modules

| module | what it is for |
|---|---|
| `rng` | seeded streams, `derive`, snapshot/restore, `shuffle`, `weighted` |
| `hash` | stateless: `hashStep`, `hash2`, `hash3`, `hashString`, `hashBytes`, `toUnit` |
| `noise` | `noise2`/`noise3`/`fbm2`/`fbm3`, gradients from a fixed table |
| `math` | `clamp`, `lerp`, `smoothstep`, `wrap`, `moveTowards`, `damp` *(Tier B)* |
| `easing` | thirteen curves, exact at both endpoints, plus `EASINGS`, `reverse`, `inOut` |
| `vec2` | the out-parameter vector API, and `ReadonlyVec2` |
| `time` | branded `EpochMillis` and `MonotonicMillis`. Types, not clocks — `core` reads no time |
| `events` | a typed emitter whose listener arrays are immutable by construction |
| `pool` | zero allocation per acquire |
| `dispose` | `Scope`, `Disposer` |
| `guard` | validators that return their argument |
| `format` | compact numbers, rates, durations |

---

## Numbers

503 tests, **100% statements, branches, functions and lines**, 7.25 kB gzipped, and no
`toBeCloseTo` anywhere — endpoints are asserted exactly, which is why `backIn` is written
`t³ + c·t²(t−1)` rather than the textbook form that returns `0.9999999999999998` at `t = 1`.

`v2Add` is 4.8 ns and retains nothing across three million calls. See
[`docs/PERFORMANCE.md`](../../docs/PERFORMANCE.md) for why out-parameters exist despite
allocation winning the *mean* by 25% — the argument is entirely in the tail.

---

MIT. Part of [Lattice](https://github.com/plausibleventures/lattice) — the grid underneath.
