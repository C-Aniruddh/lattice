# `iso.ChunkGrid` — does it ship?

**Task `K11`. Owner: lattice-architect. Status: decided.**

Flagged by `docs/rfc/demo.md`'s coverage ledger as a **delete candidate rather than a coverage
gap**: no consumer, no planned consumer, and all fifteen planned exhibits fit a single viewport.

---

## 1. The decision

> **Delete it. `ChunkGrid` and `ChunkGridOptions` come out of `@latticekit/iso`, and the unbounded
> world stays — carried by `tileSourceOf`, which is where it already lives.**

The reason is not "nothing uses it". Three things use nothing today and all three should stay. The
reason is that **the capability `ChunkGrid` was built to provide is provided by another export in
the same file**, and what remains after subtracting that is a capability the gallery is
structurally unable to demonstrate.

---

## 2. What is actually on the table

| | |
|---|---|
| exports | `ChunkGrid`, `ChunkGridOptions` (`.lattice/kit.json` `packages.iso.exports`) |
| source | `packages/iso/src/tilemap.ts:234-415` — 182 lines, of which roughly 90 are doc comment |
| tests | `packages/iso/test/tilemap.test.ts:153-270` — 118 lines, 11 cases, passing |
| **size** | **0.64 kB gzipped**, measured by deleting the class from `packages/iso/dist` and re-running `tools/size.mjs`'s own strip-and-gzip |
| consumers | **none.** Not in `examples/`, not in `packages/`, not in any of the 15 exhibit rows |

That size number is the one worth holding onto. `iso` currently measures **11.55 kB against a
12 kB budget — 0.45 kB of headroom.** `ChunkGrid` is 0.64 kB. **It is larger than everything `iso`
has left**, in a package that is still growing `height`, `anchor` and `camera.fitBounds`, and it is
spent on the only module in the kit with no reader.

This is not a rounding error being dressed up as an argument. It is the difference between `iso`
absorbing its next module and `iso` arriving at the budget board the way `input` did.

---

## 3. Why it exists, and why that argument was good

From `docs/rfc/iso.md` §3.5, and it is worth quoting because it is not a bad argument:

> **Same interface as `TileGrid`, so pathfinding and placement cannot tell them apart.**

Three storages — island, infinite world, procedural — behind one two-method interface, so that
`PathFinder`, `FlowField`, culling and placement are written once against `TileSource` and never
learn which they were handed. That is a genuinely good piece of design thinking and it has already
paid for itself twice, in places that are *not* `ChunkGrid`:

- **`PathOptions.maxNodes` exists because of it.** Its doc comment names the reason: *"Not a
  performance knob — a **determinism and liveness** one. On an unbounded `ChunkGrid` an unreachable
  goal otherwise searches until the tab dies."*
- **`PathFinder`'s storage design exists because of it.** *"An unbounded `ChunkGrid` therefore costs
  exactly what a bounded island does, and no allocation depends on how far from the origin the
  search happens to be."*

**Both of those stay true and both of those stay.** That is the crux of this decision and it is
easy to miss: the design pressure `ChunkGrid` applied has already been absorbed into the pathfinder
permanently. Deleting the class does not un-harden `PathFinder`, does not remove `maxNodes`, and
does not make an unreachable goal hang a tab. **The pressure was cashed; the class is the receipt.**

---

## 4. The three arguments against keeping it

### 4.1 `tileSourceOf` is already the infinite world, and it is three lines

```ts
export function tileSourceOf(get: (gx: number, gy: number) => number): TileSource {
  return { get, has: () => true };
}
```

`has` is unconditionally `true` — *"a function is defined everywhere, so this source has no edge."*
Every claim in §3 is satisfied by this export alone. Pathfinding still cannot tell an island from
an infinite world; `maxNodes` is still the thing standing between an unreachable goal and a dead
tab; `PathFinder` still allocates nothing that depends on distance from the origin.

So `ChunkGrid` is not "the infinite world". **`ChunkGrid` is the infinite world you can write
to** — and *writable at unbounded extent* is the whole of its distinct capability, a much narrower
thing than the module header advertises.

### 4.2 The "one interface" claim is already false on the half that matters

`ChunkGrid` implements `MutableTileSource` by **throwing unconditionally on two of the four members
that interface adds** to `TileSource`:

```ts
fill(value: number): void {
  throw new RangeError(`ChunkGrid.fill: an unbounded map cannot be filled …`);
}
fillFrom(get: (gx, gy) => number): void {
  throw new RangeError('ChunkGrid.fillFrom: an unbounded map cannot be filled …');
}
```

Both throws are correct, both are well-worded, and both are the point. **Substitutability holds for
`TileSource` — `get` and `has` — and does not hold for `MutableTileSource`.** But `TileSource` is
the read interface, and the read interface is precisely what `tileSourceOf` implements in three
lines. So the polymorphism the design argued for lives entirely in the half `ChunkGrid` is not
needed for, and the half `ChunkGrid` is uniquely needed for is the half where the polymorphism does
not exist.

`packages/iso/README.md`'s module table still advertises the older claim — *"all behind one two-method
interface"* — which is true of `TileSource` and reads as though it were true of writes.

### 4.3 It cannot be demonstrated under the gallery's own rules

This is the argument that decides it, and it is the one the brief asks for: *name the game shape
that needs it and propose the exhibit that is that shape.*

The shape is real and easy to name. **A world the player extends by playing** — a builder with no
map edge, a settlement that grows past whatever rectangle it opened with, a fog-of-exploration
record over unbounded ground. That is a legitimate genre and `ChunkGrid` is a competent answer
to it.

**And it cannot be an exhibit**, against `docs/GALLERY.md`'s own criteria:

| the rule | what an infinite-world exhibit does to it |
|---|---|
| 1. *"the first frame is the pitch… framed so the world fills the viewport"* | an unbounded world's pitch is what is **not** on screen. The first frame of a chunked world and the first frame of a `TileGrid` are the same picture |
| 2. *"one idea, shown well… if you cannot say which in a sentence"* | the idea is "memory is allocated on write, not on look". That is a sentence about an allocator |
| 4. *"under 250 lines, most of it art"* | the art is identical to Island's. Every added line is logic, which `GALLERY.md` calls *"the kit's own report card"* and scores in the wrong direction |
| *"if it is not visible in the first ninety seconds, it does not belong in an exhibit"* | the only way to see chunking is `chunkCount` climbing in a readout. **A debug overlay is not an exhibit** |

An exhibit for `ChunkGrid` would be Island with a number in the corner, and the number is the
exhibit. That is the shape of a feature that cannot be sold, and **a kit whose gallery is
explicitly "the widest test it will ever get" should not ship surface that test is structurally
incapable of reaching.** Not "has not reached yet" — *cannot*, by the gallery's own rules, in any
plausible revision of the list.

---

## 5. The argument for keeping it, taken seriously

Three real costs, because "we might want it" is exactly the reasoning that produced this module and
the same reasoning does not get to save it unexamined.

**"It is well-built and fully tested; deletion throws away good work."** True, and the work is not
thrown away — see §6. But sunk cost is not a design argument, and the kit already ruled on this
shape: `iso` deleted its own `Scene` and `draw` deleted its own `DrawList`, both working, both for
the reason that *the export was a promise nobody was collecting on* (`docs/SEAMS.md`). This is the
third instance of a decision the repository has twice made in the same direction.

**"Re-adding it later costs more than keeping it."** This is the strongest one, and the answer is
that the cost is bounded and known: about 90 lines of executable code, whose full public surface,
chunk-key packing scheme and rationale are written out in `docs/rfc/iso.md` §3.5 and preserved
below. Re-adding is a day. Maintaining it is every `iso` refactor, every audit, every budget
review, and every agent who reads `tilemap.ts` and spends ten minutes deciding which of three
storages to use when there are two.

**"An unbounded map is a normal thing for a game engine to have."** For an engine, yes. **Lattice
is not an engine and says so** — nine small libraries, `AGENTS.md`'s *"prefer fewer, sharper
primitives to a wide surface. Every export is a promise."* The comparison class is not Godot; it is
a 12 kB package that also declines to ship a `Deque`, a `RingBuffer` and a `SortedSet` for the
identical reason `core` gave when it refused a heap: **one speculative consumer is not a consumer.**
`ChunkGrid` does not have one.

---

## 6. What is preserved, and where

Deleting the surface is not deleting the design. Three things survive and they are enough to
rebuild it in an afternoon:

1. **`docs/rfc/iso.md` §3.5** already carries the complete declared surface — constructor,
   `chunkCount`, `forEachChunk`, both documented throws — plus the reasoning. It stays exactly as
   written, with one added note pointing at this file.
2. **This RFC** carries the two non-obvious implementation facts, so that a re-implementation does
   not have to re-derive them:
   - **The chunk key is one number, not a string.** `(cgx + 2²⁰) · 2²¹ + (cgy + 2²⁰)`, with the
     reach clamped to ±2²⁰ chunks. Two 21-bit fields fit inside the 53 bits a double represents
     exactly, so the packing is lossless and a chunk's key is the same number on every engine. *A
     string key is an allocation on every read, and reads happen inside the pathfinder.*
   - **One-slot lookup memo (`#lastKey` / `#lastChunk`).** Tile access is overwhelmingly sequential
     — a draw loop or a pathfinder expansion walks neighbors — so a single remembered slot removes
     most `Map` lookups with no cache to invalidate.
3. **The pressure it applied is already load-bearing elsewhere**: `PathOptions.maxNodes` and
   `PathFinder`'s index design. Neither changes.

`docs/rfc/demo.md` Appendix A is the precedent for this: a correct, well-argued design kept in an
RFC after the game that motivated it was cut, *"so that whoever finds this can decide with the
evidence rather than without it."* Same move, one step further — here the surface goes too.

---

## 7. What would have to become true to bring it back

Written as a trigger a future agent can actually evaluate, not as a mood.

> **The trigger is a second writer, not a bigger map.** `ChunkGrid` earns its place the day
> something in this repository writes tiles at coordinates it did not enumerate up front — a world
> the player extends by playing, rather than a large world framed to fill a viewport.

The concrete, checkable form: **the first time an exhibit or a game has to reallocate a `TileGrid`
because the player built past its edge.** Until that happens, `TileGrid` covers every bounded world
and `tileSourceOf` covers every unbounded read, and the space between them is empty.

Two things that are explicitly **not** triggers, because they are the plausible-sounding ones:

- **"An exhibit wants a bigger map."** Bigger is `new TileGrid(512, 512)` — 256 kB at 8 bits, which
  is less than one of the sprite caches `draw` builds without comment.
- **"An exhibit wants procedural terrain that goes on forever."** That is `tileSourceOf`, and it
  costs nothing at all. Wanting to *cache* it is the trigger's near-miss: caching a generated world
  is a `Map` of `TileGrid`s in the game, and if three games write that same `Map`, **that** is the
  evidence, and the thing to bring back may not be `ChunkGrid` as designed.

If the trigger fires, re-read §6 before re-implementing: the two implementation facts are the parts
that are easy to get wrong and expensive to discover.

---

## 8. The deletion, precisely

This RFC owns no code. For whoever executes it in `packages/iso`:

| # | change | note |
|---|---|---|
| 1 | delete `ChunkGridOptions` and `class ChunkGrid` — `packages/iso/src/tilemap.ts:234-415` | keep `makeStore`; `TileGrid` calls it. Its `label` parameter exists to serve two callers and may collapse |
| 2 | delete `CHUNK_LIMIT` and its doc block | only `ChunkGrid` reads it |
| 3 | `packages/iso/src/index.ts:129,134` — drop `ChunkGrid` from the value export and `ChunkGridOptions` from the type export | |
| 4 | `.lattice/kit.json` — remove both from `packages.iso.exports` | `npm run lint` fails on an export not listed, and on a listed export that does not exist |
| 5 | delete `describe('ChunkGrid', …)` — `packages/iso/test/tilemap.test.ts:153-270` | and the `ChunkGrid` arm of the shared-behavior case at `:248` |
| 6 | `packages/iso/test/invariants.test.ts` — remove `'class ChunkGrid::get'` and `'class ChunkGrid::has'` from the `perFrame` map at `:320-321`, **and change `expect(checked).toBe(56)` to `54`** | that count is a deliberate guard against a regex that stops matching; it will fail loudly and correctly |
| 7 | **the module header of `tilemap.ts` — the three-row table becomes two rows** | this is the one that matters. The table is the file's thesis and a stale one teaches the wrong thing |
| 8 | `packages/iso/README.md` module table, the `tilemap` row — *"`TileGrid` (the island), `ChunkGrid` (the infinite world), `tileSourceOf` (procedural), all behind one two-method interface"* → two storages, and say plainly that `tileSourceOf` **is** the unbounded one | see §4.2; the current line overstates what the write interface promises. **Cite by content, not by line — that file is being edited concurrently** |
| 9 | `packages/iso/src/path.ts:105` and `:748`, `packages/iso/src/height.ts:30` — three doc comments name `ChunkGrid` | **do not delete the reasoning.** `maxNodes` and the pathfinder's index design are still justified by unbounded sources; reword to name `tileSourceOf`, which is unbounded and remains |
| 10 | `docs/rfc/iso.md` — leave §3.5 intact, add one line pointing here | §6: the RFC is the archive |
| 11 | `docs/rfc/demo.md:132,219,240,242` — the ledger rows resolve from "delete candidate" to "deleted, `docs/rfc/chunkgrid.md`" | |

**Invariants after the deletion**, phrased so a failing case is obvious:

- `npm run size` reports `iso` at or below **10.95 kB**. If it does not, something else grew in the
  same commit and the two changes need separating.
- No file under `packages/`, `examples/` or `test/` matches `ChunkGrid`. `docs/` still does, on
  purpose, and `docs/rfc/iso.md` §3.5 is the reason.
- `PathOptions.maxNodes` still has a stated justification naming a real unbounded source. **Item 9
  failing silently is the only way this deletion does damage**: it would leave `maxNodes` looking
  like the performance knob its own comment insists it is not, and the next author to see an
  unexplained 20,000 will raise it.

---

## 9. The related fact: `draw/src/index.ts` asserts a consumer that does not exist

Flagged with `K11` because it is the same species of problem — a comment keeping surface alive by
naming a reader nobody checked for.

```ts
// packages/draw/src/index.ts:121-123
// `canvas2d` is the only module in the package that names a canvas. `record` is the one a Node
// test imports, and it is `src/` rather than `test/` because `ui` wants it for layout
// measurement without a canvas.
```

**Checked:** `packages/ui/src/thumb.ts:21` imports `createOffscreenSurface` from `@latticekit/draw`.
Nothing in `packages/ui/src` — and nothing in `examples/` — references `createRecordingSurface`,
`RecordingSurface`, `RecordingTarget`, `Op`, `OpName` or `ESTIMATED_ADVANCE_RATIO`. The comment is
false, and `docs/rfc/demo.md` independently reached the same finding: *"a comment asserting a
consumer that does not exist is how an orphan survives an audit."*

**The module stays; the comment is wrong.** `record.ts` has a real planned consumer that the false
one was standing in front of: the **Replay** exhibit (`G11`), whose brief is *"prove it: the same
seed and log land on the same pixel"* — and an op-stream comparison is exactly how you prove that
without a canvas. That is a better justification than the one written down, and it is the one that
should be written down.

Proposed replacement, for whoever owns `packages/draw`:

```ts
// `canvas2d` is the only module in the package that names a canvas. `record` is `src/` rather
// than `test/` because a headless op stream is a product feature, not a test fixture: the
// Replay exhibit proves "same seed, same log, same pixel" by comparing op streams, which needs
// no canvas and no image diff. It has no consumer today — `ui`'s thumbnails use
// `createOffscreenSurface`, not this.
```

Note the last clause. **The honest comment says the consumer is planned, not present**, so the next
audit measures this module against `G11` shipping rather than against a claim that reads as
already-true. A justification that names a *future* reader and says so is checkable; one that names
a present reader who does not exist is how this module survived two audits.

One fact for whoever owns `draw`'s budget, since it is adjacent and unpleasant: `draw` currently
measures **12.74 kB against 12 kB — over by 0.74 kB** — and `record.js` is **0.88 kB gzipped**. The
module whose justification turned out to be false is very slightly larger than the overage. **That
is a coincidence and not a recommendation**: unlike `ChunkGrid`, this surface has a named exhibit in
the plan, so the correct order is *fix the comment now, and if `G11` is ever cut, revisit this
module the same day.*
