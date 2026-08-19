# MIGRATION — a Lattice exhibit

> **A v1 save opened by a v5 build, stepping the chain in front of you.**

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-migration
# http://localhost:5201
```

An archive of save files, and five builds of the same game standing in a row. Every crate on the
floor is envelope bytes and nothing else. It is handed to the **v1 build**, then the **v2 build**,
then the v3 — one terrace, one migration — and what it is carrying changes shape under you as it
climbs. A build that refuses a save topples it back over the rung it failed, and says why.

The chain is `@latticekit/persist`, the migrations are real, and no crate on this ladder is
showing a field the build under it has not produced.

---

## Who built this, and from what

**Built by Claude**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` and `docs/SEAMS.md` alone.** It was given its own row of the exhibits table, the
whole of the standard, and the tools — and it was deliberately **not** pointed at any existing
exhibit's source. Pattern-matching a neighbouring exhibit tests the neighbour; the fan-out was
testing whether the written spec is followable by a stranger.

Everything below this line is that agent's report, kept as it wrote it. What changed on the way
into the repository is at the very bottom, and it is one import path and one port.

---

## What is actually running

`src/chain.ts` declares the four rungs **once** and seals the builder at each of them, which is
what makes five builds out of one declaration:

```ts
const c1 = migrations(1, isV1);
const c2 = c1.step(2, WHY[0], …, isV2);
const c3 = c2.step(3, WHY[1], …, isV3);
const c4 = c3.step(4, WHY[2], …, isV4);
const TOP = c4.step(5, WHY[3], …, isV5).seal();
export const BUILDS = [c1.seal(), c2.seal(), c3.seal(), c4.seal(), TOP].map(shipped);
```

`persist`'s own doc comment blesses this — *"the builder is immutable: `step` returns a new one, so
a chain may be branched in a test"* — and it is the whole apparatus. A crate standing on terrace
*k* has been through `BUILDS[k].decode(text)`: real checksum, real chain walk, a real recognizer at
every version on the way. About twenty saves a second cross a rung. It does not appear in the
frame cost.

| rung | the migration | the seam |
|---|---|---|
| 1 → 2 | one coin counter became a wallet of two currencies | the ordinary case |
| 2 → 3 | the stored `#rrggbb` became the hue it was derived from | **persist the input, never the derived value** |
| 3 → 4 | `ticks` and `runs` collapsed into the best run they only ever computed | **`Infinity` is Tier A and does not survive JSON** |
| 4 → 5 | the wallet learned to hold a third currency | the ordinary case again |

Six outcomes are live at once, none of them scripted — the archive is filed from the seed and
nothing but `decode` knows which save is which:

| reason | where it comes from | where you see it |
|---|---|---|
| *(migrated)* | an ordinary v1 save | climbs all five decks and enters the vault |
| `invalid` | `ticks / runs` with `runs: 0` is a legal `Infinity`; `expectSerializable` in the v4 recognizer refuses it | climbs three rungs, falls off the fourth |
| `migration-failed` | the same save opened by the **v5** build, which names the rung instead | the placard names `3 → 4` |
| `corrupt` | one flipped character in the payload, checksum untouched | refused at the gate, never gets on the ladder |
| `orphaned` | stamped below the chain floor | refused at the gate |
| `future` | a v5 envelope opened by a lower build; the store goes read-only | refused, and the placard says the save is intact |

---

## How a visitor **sees** the chain step

Nothing on screen says "migrated". Six things change, and every one of them is a consequence:

1. **The ground under the crate changes colour.** Five decks, cold slate at v1 warming to gold at
   v5, each stencilled with its version numeral like runway paint.
2. **The crate gains a part.** One post at v1, two at v2, a struck bright chip replacing a dull
   painted swatch at v3, a mast with a pennant at v4, a third post and a gold ring at v5. They are
   cumulative, so counting the parts is counting the rungs.
3. **The wall it climbed says what happened to it**, in `wallText`, from `chain.WHY` — the same
   string `migrations().step()` was given as its `why`. There is no second copy to drift.
4. **The card fills in from the bottom.** The deck the followed save is standing on lights gold;
   every rung it has climbed turns green behind it.
5. **The bytes never change.** The envelope in the readout is the same string the whole way up —
   which is the point: nothing was rewritten, a chain was walked.
6. **A refusal is a fall.** The crate tips, goes back over the rung, and lies at the foot of that
   wall with the reason on the placard.

And two knobs make the argument you cannot make with a screenshot:

- **brand saturation → 0.02.** Every crate above the `2 → 3` wall goes grey. Every crate below it
  keeps its colour, because those are carrying a `#rrggbb` an old build wrote down and a retune can
  never reach them. The boundary is exactly the rung where the migration happened.
- **the build opening the archive → v1.** The four rungs above are washed out of the world, no
  save leaves the first deck, and `invalid` vanishes from the tally — because the rung that
  produces the infinity is not in that build.

---

## The numbers

Run at 1440×900 (a 1440×813 viewport in headless Chrome), seed `archive`.

| | |
|---|---|
| **logic** | **196** code lines — `chain.ts` 64, `main.ts` 56, `ladder.ts` 48, `hud.ts` 28 |
| **art** | 307 in `src/*.ts` — `crates.ts` 122, `yard.ts` 80, `legend.ts` 69, `palette.ts` 26, `place.ts` 10 — plus **62** of CSS in `index.html` |
| ratio | 196 logic : 369 art |
| bundle | 127.7 kB, **46.6 kB gzipped**, seven `@latticekit` packages and no other dependency |
| saves on the ladder | **750**, about 230 in the opening frame |
| shelved stock in frame | 400–1,400 depending on zoom |
| depth sorter | 562 items at the opening zoom, 2,165 at minimum zoom |
| `decode` calls | ~20 a second, sustained |
| **frame work** | **1.97 ms mean** at the opening zoom; 4.45 ms at minimum zoom |
| worst gap / 10 s | 10.4–11.3 ms against a 6.3 ms cadence — **see the finding below** |
| looking harness | `anything` 4673 colours · `framing` 6% · `motion` 19.4% · `legibility` 35 nodes clean · `console` clean |

`npm run gallery` prints the logic figure.

---

## Where the kit fought back

Ten findings, most-load-bearing first.

**1. A wall whose base runs along `gx − gy` is edge-on, and nothing says so.** The first build laid
the staircase along that diagonal — `GALLERY.md` measures it as the one that maximises a canyon's
apparent depth — and every riser rendered as a *zero-pixel-wide* face. The heightfield produced a
zigzag of stretched diamonds that reads as a diagonal stripe; a course of `isoBox` along the same
line showed only 16 px slivers of each box, because each is drawn over by the next. `isoWall`,
`boxSilhouette` and `isoTerrain` all accept that geometry happily. Turned onto `−(gx + gy)` it
became the ordinary iso staircase, and `wallText` became usable — the migration prose is on the
wall *because* of the rotation. **The general fact is worth a line in `iso`'s projection doc**: a
vertical face is visible exactly when its base line has a non-zero screen-x extent, and one of the
two diagonals has none.

**2. A continuous riser on a diamond grid renders as triangles.** `GALLERY.md` already records this
against `Canyon`, and it is exactly right: a rise spread over two tiles puts the whole rise on one
corner of each quad and the staircase comes out serrated. The fix here was not a snap but a
**discontinuity** — the height field is a pure step, every tread dead level, and the face between
two treads is drawn as a wall rather than as ground. Worth generalising in `GALLERY.md`: where a
landform's silhouette should be orthogonal, take it *out* of the height field.

**3. `boot.worstMs` measures the environment, not the exhibit — and § Scale gates on it.** Mean
frame work here is **1.97 ms**. The worst gap reads 10.4–17 ms, and it does not track scene size:
zooming *in* to a 0.73 ms mean made the worst gap **worse** (15 ms), and hiding the entire DOM
overlay changed it by 0.1 ms. In headless Chrome with `--disable-gpu` the rAF cadence is 6.3 ms and
free-running; the tail is the harness. The cost row is a gate and it has caught real bugs, so this
is not an argument to remove it — but an exhibit that is judged on `worstGapMs` in an environment
that is not vsync-locked is being judged on the environment. **Report the mean beside it**, or the
row will fail exhibits that are fast and pass exhibits that are slow on a quiet machine.

**4. `examples/_shared` is not publishable, so an exhibit outside the monorepo vendors it.**
*(Resolved by the move — see the last section. The finding stands for anyone building outside the
repository.)* This exhibit copied 2,360 lines of `bootstrap`, `panel`, `bucket`, `params` and
`cost` into `_shared/` beside `src/`. `bootstrap` and `createBucket` are kit features in everything but name — they close
two silent boot mistakes and one cross-package contract, none of which is exhibit-specific. The
panel and `cost` genuinely are gallery instruments. The seam runs through the middle of the folder
and its own README says so; this is the second exhibit's worth of evidence for splitting it.

**5. `wallText` ignores `TextStyle.size` entirely.** It sizes from the wall's screen height and
then shrinks to fit the segment, so the type size is a function of geometry and the only way to
make a sign smaller is to make the wall shorter or the segment longer. That is a reasonable default
and an impossible override; a `maxSize` on the style would cost one clamp.

**6. `persist` cannot be asked for a chain's intermediate values.** `chain.run(value, from,
onEnter)` reports the version it arrives at but never the value, so an exhibit that wants to *show*
a save at each rung has to seal the builder five times and stand up five `Store`s over five
`memoryStorage()`s that never store anything. It works, the package's doc blesses branching, and
the result is honest — but a `to` parameter on `run` would remove four stores and is the shape
every "show me the upgrade" UI wants.

**7. The same save reports two different reasons depending on which build opened it.** The
`Infinity` save is `invalid` from the v4 build (it reached that build's head and the head recognizer
refused) and `migration-failed` at rung `3 → 4` from the v5 build. Both are correct and the
distinction is genuinely useful — the exhibit prints it — but a game shipping a support code would
print two codes for one bug, and nothing in `persist`'s docs points at the pair.

**8. Picking and drawing are written twice, in two unit systems.** `BoxOpts.z`/`h` are storeys;
`Volume.zPx`/`hPx` are world pixels; the offsets and extents are tiles in both. A game using
`defineSprite` gets `spriteVolume` for free; a game drawing with raw `isoBox` — which is what a
crate wants — writes the same box twice and keeps them in step by hand. A `boxVolume(gx, gy,
BoxOpts)` helper would close it.

**9. `draw`'s sub-pixel snap is not in the barrel.** Any geometry a game draws beside the kit's — a
chip on a lid, a stencil on a deck — has to re-add `pen.snapX`/`snapY` by hand or it crawls against
its own ground while the camera moves. `src/place.ts` is those three lines. `terraces` filed this;
it is still true.

**10. `renderFrame`'s Terrain range is margined on both axes.** A camera cannot know what a
heightfield is, so the box grows by `maxHeightPx / TILE_H` rows on *both* — but on a staircase the
elevation lives on one axis, and the margin on the other is pure waste. Walking `u = gx + gy` and
`v = gx − gy` and testing each **row** once for its own elevation cut about a third of the walk here.
`terraces` reported the same thing from the other direction; two exhibits hand-rolling the same
depth-space walk is the definition of a gap in the kit.

*Also measured, and worth writing down:* dropping the per-tile terrain seam and halving the
shelf lattice below 0.55 zoom took the minimum-zoom mean from **16.6 ms to 4.45 ms**. That is
§ Scale's *spend the detail where the eye is* applied literally — the seam is a whole extra stroke
per tile, and at 22 px a tile it is a grey haze rather than a hairline. It is the cheapest lever in
this exhibit by a factor of four, and reducing the count was never needed.

---

## Where the specs made its author guess

Kept verbatim, and separate from the findings above because these are places the *document* could
not be acted on rather than places the kit fought back.

### `docs/GALLERY.md`

**A. "Markup generated from data is logic, always" — the biggest guess in the build.** `legend.ts`
builds one card row per rung by iterating `chain.WHY`, a `const` array of fixed length. The rule's
example is *"one row per resource, a list whose length the game decides"*. I read "state" as *what
the player did*, not *a constant the author wrote*, and classified it art. **If the stricter
reading is intended, `legend.ts` is logic, the exhibit is 265 lines, and it fails the cap.** The
alternative — duplicating the four `why` strings into `index.html` — puts the ladder's prose in two
files with nothing comparing them.

**B. Is a failure *message* art?** `excuse()` turns a `FailureReason` into a sentence. Deleting it
changes only what the exhibit *says* — but "says" is not "looks like", and "every ambiguous module
is logic" pushed me to keep it in `chain.ts`. If prose-selection is art, I left eleven lines of
headroom unclaimed.

**C. Is 200 passing or failing?** "Under 200 lines" and "Under 200 and it passes" imply ≤ 199. I
targeted 196 rather than test it.

**D. The judging viewport.** § Scale specifies 1440×900. `look.mjs` defaults to 1280×800 and
`--size 1440x900` yields a 1440×**813** viewport, because `--window-size` includes browser chrome.
Nothing says which number the gate is scored at; I tuned at 1440×813.

**E. The cost row gates on a figure that is not about the exhibit.** *(This is finding 3 above,
from the document's side.)*

**F. "Density measured in hundreds" — of what,** when the repeated thing is a data structure rather
than a tree? I counted saves. It passes under any reading, but the row is written for scenery and
an exhibit about persistence had to interpret it.

**G. Is a warm-up legitimate?** The yard needs about twenty-one seconds of simulated time to fill,
and rule 3 wants motion in the *first* frame. I ran the real `stepYard` loop for that long before
`start()` — same code, same `decode` calls — then **zeroed the counters**, because a readout
opening at `carried 31` reads as a number somebody typed. Nothing in the document covers either the
warm-up or the zeroing.

**H. Is "which build opens the archive" a kit parameter or exhibit plumbing?** The panel must
expose real kit parameters and "nothing in the panel is exhibit-specific plumbing". My headline
knob moves `MigrationChain.head` — but only by selecting among five chains this exhibit sealed. I
declared it as the kit parameter because the head is exactly what it moves. A stricter reading
leaves the exhibit with no headline knob.

**I. `?cost=0` suppresses "the frame cost and nothing else"** — but the refusal counters are also
numbers a stranger could misread as an indictment. The document is unambiguous, so I left them.
Recording it because I nearly did the wrong thing.

**J. The row's one-line brief admits two different exhibits.** *"A v1 save opened by a v5 build,
stepping the chain in front of you"* does not say whether five builds should be simultaneously
present, or one build stepping a save through five versions. I chose the former, because "the chain
IS the version" is only *visible* when more than one version's build exists at once.

**K. Where does an exhibit live when it is not in the monorepo?** The line rule's command is
`cd examples/<exhibit>` and *"`examples/_shared` is never counted"*. I built at the root of a
standalone directory with `_shared/` beside `src/`, so `src/*.ts` means the same thing — but
someone could argue the 2,360 vendored lines should count.

### `docs/SEAMS.md`

**L. The stated *reason* for "persist the input, never the derived value" does not apply to the
kit's own colour path.** SEAMS says derivation "needs `cbrt` and `pow`, which are Tier B". `draw`'s
`hueToHex` is HSL — max, min, divide, no `pow` anywhere. So the rule holds (a stored token is an
engine artifact a retune can never reach) while its justification does not. I built rung `2 → 3` on
the rule, and inverted the derivation in Tier A arithmetic to make the point.

**M. Which end of the `Infinity` fact was I meant to show?** SEAMS frames it as a value that gets
*written down* and comes back as `null` with a valid checksum. My sharpest version is a value
*produced by a migration* and refused before it can be written. Same fact, different failure
reasons. I chose the refusal because "degrade with a reason" is showable and a silent `null` is, by
construction, not.

**N. Must an exhibit that never reads a tile coordinate still declare its terrain?** "Silence is
not a valid answer", and the `flat-ground-pick` diagnostic fires "the first time a coordinate is
read". This exhibit reads `event.sx`/`sy` and picks through the sorter, so an omission would have
been silent *and* harmless. I called `setTerrain` anyway. It buys nothing but honesty, and SEAMS
does not say whether it is owed.

**O. Is a stamping clock a second clock?** "Exactly one thing decides when work happens." `persist`
requires an injected `now`, so `chain.ts` holds a module-level epoch that is wound backwards to
stamp each archived envelope with a real age. It never advances on its own and nothing ticks it —
but the rule is written about clocks and carves out no exception for a stamp.

**P. May a standalone exhibit take `Bucket`?** SEAMS gives the sorted draw list to `iso`, but the
`Bucket` that pairs items with the sorter — and enforces the one-list rule the tap depends on —
lives in `examples/_shared`, which is not published. I vendored it. Nothing says whether that is
allowed or whether the pairing should be re-derived.

**Q. Severity is written as though every consumer has a player.** `persist` maps `refusing-newer`
to a modal the player must acknowledge. Here `future` is one wreck among many with no modal,
because there is no player and no session to lose. Defensible, but the row does not admit a
consumer that has neither.

**R. Where does "art that reads state" become logic?** `crates.ts` branches on `state.version` to
choose between two colour paths and reads a panel value for the derivation. GALLERY's test —
*would deleting it change only how the exhibit looks* — answers yes, so it is art. But the boundary
between art that reads state and logic that decides is not drawn anywhere, and this exhibit leans
on it hard.

---

## What changed when it moved into the repository

Two things, and neither is the exhibit.

**The vendored `_shared/` beside `src/` is gone**, and the imports resolve to the real
`examples/_shared`. All seven files were **byte-identical** to the originals — nothing was forked,
and nothing the copy did the real one cannot. That closes finding 4 for this exhibit and leaves it
standing for anybody building outside the repository, which is what it was always about.

**The dev port moved from 5194 to 5201**, because `endless` was already answering on 5194. The
`strictPort` is gone with it: several exhibits are run at once here, and a strict port turns
"somebody else is already running theirs" into a crash rather than into a different number in the
banner.

`boot.setTerrain({ field: GROUND, maxHeightPx: MAX_HEIGHT_PX })` was already there — see guess N
above, which is the agent asking whether it was owed and calling it anyway.
