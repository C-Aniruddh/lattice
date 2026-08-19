# The seams

Ten RFCs were written in parallel by ten agents who could not read each other's drafts. What
kept them composable was routing: every cross-package finding went back through the
orchestrator, and every seam got argued until one side owned it.

**This file is the result — the settled contracts, one row each.** A builder implementing any
package must read the rows their package appears in. They are not suggestions; each one is a
place where two packages will otherwise both be individually correct and jointly broken.

---

## Who owns what, where both sides had a claim

| the seam | owner | why, and who disputed it |
|---|---|---|
| tap → grid cell | **`iso`** does the maths, **`input`** owns the gesture and calls it | Both claimed it, both were told to stop hedging, and both landed on the same split independently. Game code never converts coordinates. |
| the **ground** that tap resolves on | **`iso`** marches the heightfield, **`input`** holds the declaration and calls it | The half of the row above that was named and never wired, and it shipped a wrong answer for it. `input` had no way to be handed a `HeightField`, so every `gx`/`gy` inverted the projection on the plane `z = 0` — the only plane it inverts — and on a hillside that is a real tile, beside the right one, moving with the pointer: 281 px and 14–16 tiles on `examples/terraces`, 212–237 px shipped in `examples/demo`, and in `examples/clay` an error that *moves* as the visitor raises the ground under their own cursor. Neither side could take the whole seam: `iso` may not name an event, and `input` reimplementing the march would put a projection on layer 2 and a heightfield in a package that must never learn what is in the world. So `input` takes `terrain: { field, maxHeightPx } | 'flat'` and calls `iso.worldToTileOnHeights`; a `HeightField` is the shape of the *ground*, carries no ids and answers no "what is here", so the no-hit-boxes rule survives intact. **Silence is not a valid answer**: a system nobody declared resolves on the plane and raises `flat-ground-pick` once, the first time a coordinate is read. |
| the sorted draw list | **`iso`** sorts, **`draw`** decides which pass walks it | `iso` dropped its own `Scene` on the reasoning that *the moment it held ids it was modeling the caller's entities*. `draw` deleted its `DrawList` on the reasoning that exactly one pass in seven sorts. Both deletions; one list survives. |
| `LEVEL_H` (world pixels per storey) | **`draw`** | Ruled into `iso`, disputed by `draw`, and the dispute won: `iso`'s whole height vocabulary is pixels, so there is no signature a storey could enter through, and `iso` would export a number it never reads. It is an art proportion tuned beside `FACE_LEFT`, not a projection fact like `TILE_W`. |
| `Rect` / `Bounds` | **`iso`** | `core` refused: `draw`, `input` and `ui` all reach `iso` through the existing DAG, so layer 0 would be charging everyone for the spatial half of the kit. |
| entity ids | **`sim`** | `core` refused — an id generator is stateful and layer 0 has no module-level mutable state. `sim` made it a saved counter, never reused. |
| a priority queue | **`iso`**, alone | `core` refused with the sharpest argument in the phase: `loop` explicitly declines heaps and `sim` is closed-form, so there was **one** confirmed consumer. `Scope` and `EpochMillis` are vocabulary that makes other packages' guarantees enforceable; a heap is a container, and admitting it admits `Deque`, `RingBuffer` and `SortedSet` on identical reasoning. What `core` took instead costs zero exports — see the ordering rule below. |
| the calendar (`EpochMillis`) | **`core`** owns the type, the **game** owns the function | `loop` refused to own an epoch and the refusal was right. Three packages named the same concept; without one type they would have drifted and a save would eventually carry the wrong unit. |
| replay | **`persist`** stores and verifies, **`loop`** drives, **`input`** records | Nobody owned it and the constitution's headline claim was therefore unfalsifiable. Split three ways along the DAG, with each side declaring the others *structurally* rather than importing them. |
| the light field | **`draw`** | Nothing in the kit was emissive — `shadow` is the opposite operation — and "you can see exactly where the light stops" is the demo's whole premise. |

---

## Contracts that no single package can test

These are the dangerous ones. In each, both packages are individually correct and their
suites both pass while the product is broken. They belong in `test/contracts/`, above the
packages, and they are the reason that directory exists.

| contract | breaks as | pinned by |
|---|---|---|
| **`draw` must not reorder after `sort()`.** `iso.pickSorted` walks the same sorter instance backwards, so paint order and pick order are the same permutation or the game is lying about what the player tapped. | The tap opens the building *behind* the one under the finger. Silent, intermittent, and unreproducible from a screenshot. | `iso` I9 · a contract test |
| **The six-point silhouette order.** `iso.boxSilhouette` defines it; `draw`'s stroke must trace the same six points in the same order. | Hit-testing and pixels diverge with no test in either package noticing, because each is correct against its own idea of the shape. | `draw` invariant 21 · a contract test sited in `iso`'s suite, since `boxSilhouette` is the definition and `draw` is the conformer |
| **One pick, two callers.** A game that calls `iso.screenToTileOnHeights` itself — for a hover ring, a placement ghost, a debug readout — must get the same tile `input` puts on the event that follows. `input` resolves through a *frozen* transform and `iso`'s wrapper through the live camera, and the march behind them must be one march. | The ring sits on one terrace and the stake lands on another, and each package's suite is green because each is correct against its own copy of the bisection. | `packages/input/test/terrain.test.ts` § *the two marches are one march*. `hittest.screenToTileOnHeights` is now that composition, so the agreement holds by construction; the test stays because a composition can be unpicked and it is the only check that asks through `input`'s frozen transform |
| **The tick index is the join.** `input` buckets events by it, `persist` stores it, `loop` guarantees it starts at 0, increments by exactly one, and never skips or repeats. | A replay that reports a confident wrong answer, which is worse than one that refuses. | `loop` I24 · a contract test across all three |
| **`stepMs` is a compatibility constant.** It appears in recorded sessions. Changing `hz` is a breaking change to every log ever written. | A log recorded at 60 Hz replayed at 50 Hz diverges for reasons no stack trace will show. | `loop` I25 · `persist` refuses on mismatch by name |

---

## Rules that cross every package

- **The Lattice ordering rule.** Anything that orders by a numeric key breaks ties by
  insertion sequence, and exposes no comparator parameter. A comparator that may return `0`
  reintroduces exactly the ambiguity the rule exists to remove — and on a grid, ties are
  common, so a heap without it turns A\*'s replay guarantee into a coin flip.
- **A default that can be silently wrong is not a default; it is an unasked question.** Where a
  package cannot see enough to detect a mistake — `input` cannot see terrain, and never will — it
  can still see that nobody answered. Make the safe-looking case a *declaration* rather than an
  omission (`terrain: 'flat'`), keep the omission working, and diagnose it once. The test for
  whether this is warranted is not how likely the mistake is: it is whether the wrong answer is
  **plausible**. A wrong answer that looks wrong gets found in the first minute; one that is a
  real tile next to the right one ships.

- **Tier A promises bit-identical arithmetic and promises nothing about a round trip through
  JSON.** `Infinity` is a perfectly Tier A result and is precisely the value that does not
  survive being written down — it serializes to `null`, with a valid checksum, so no layer
  downstream can detect it.
- **Persist the input, never the derived value.** Store the player's brand hue, not the
  `#rrggbb` it derives to. Derivation needs `cbrt` and `pow`, which are Tier B, so a stored
  token is an engine-specific artifact in a file that will travel to another engine.
- **A Lattice game contains exactly one thing that decides when work happens.** Packages
  expose a tick-shaped method; they never go and find a clock. Two clocks in one game is the
  bug that overwrote a player's typed company name in the game this kit came from.
- **`loop` advances callbacks; `sim` advances value.** `loop`'s 250 ms catch-up clamp bounds
  *work per frame*. `sim`'s offline curve bounds *reward per absence*. Passing either to the
  other steals a player's night or makes the physics run slow.
- **Severity is a property of what the player loses by missing a message, not of how alarming
  it sounds.** A modal about a hypothetical blocks a first-time player at the door; a toast
  about a session that will not survive the tab closing expires unread.
