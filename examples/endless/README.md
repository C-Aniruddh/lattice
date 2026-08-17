# Endless

**A world with no edge.** Drag in any direction for as long as you like: the ground ahead is
minted from the seed and its own coordinates as it comes into range, the ground behind is thrown
away, and nothing is ever loaded from anywhere.

```bash
npm run build          # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-endless
# → http://localhost:5194/     try ?seed=atlas, ?seed=hollow, ?seed=lattice
```

The one idea, from `docs/GALLERY.md`: *a world with no edge — pan forever, chunks minted from the
seed, nothing loaded and nothing kept.*

---

## The claim, and how to check it yourself

> You can go that way, forever, and it will be there, and it will be the same tomorrow.

The third clause is the one worth distrusting, so the exhibit makes it performable rather than
asserting it. There is a landmark generator — one beacon in roughly every four hundred standing
things, the only vertical line and the only light in the world — and three buttons:

1. **Pin this chunk.** Fingerprints the 16×16 block under the middle of the frame with
   `core.hashBytes`, which is Tier A.
2. **Travel** until the readout says `Evicted — it is not in memory anywhere`. That takes about ten
   screens; the live chunk count sits at its ceiling and the eviction counter climbs.
3. **Return to pin.** The chunk is re-minted from nothing but its coordinates, re-fingerprinted, and
   compared with what was taken before it was thrown away.

The line then reads **"Evicted, re-minted on return, and bit-identical. Same seed, same world."**
If it ever reads `DIFFERENT`, that is a bug worth a report — it means something in the generator
picked up a dependency on the order chunks were reached.

The stronger form of the same claim, which is what the code is actually built to, can be run from a
console:

```js
const m = await import('/src/chunks.ts');
m.open('endless');
const fp = (cx, cy) => { const k = m.keyOf(cx, cy); m.chunks.delete(k); m.mint(cx, cy); return m.fingerprint(m.chunks.get(k)); };
const spots = [[0, 0], [3, -2], [-7, 11], [120, -64], [-3000, 2500]];
const first = spots.map(([a, b]) => fp(a, b));
for (let i = 0; i < 400; i++) m.mint((i * 37) % 91 - 45, (i * 53) % 77 - 38); // churn, in a different order
const second = [...spots].reverse().map(([a, b]) => fp(a, b)).reverse();
first.every((v, i) => v === second[i]);   // → true
```

Four hundred unrelated chunks minted in between, the same five re-minted in reverse order, one of
them 48,000 tiles from the origin. Identical.

---

## Why it is position-deterministic and not sequence-deterministic

**`boot.rng` is used for nothing in this exhibit.** Its *seed* is, and that is all.

A single sequential `Rng` drawn from as you pan is deterministic in the sense that a replay from
tick zero reproduces it — and completely useless here, because the field it produces depends on the
path the player walked to reach it. Pan away from a landmark and back and you get a *different*
landmark. Everything in `chunks.ts` is instead a pure function of `(seed, gx, gy)` through `core`'s
`noise2` / `fbm2` / `hash2`, each documented as having no cursor, no setup call and no permutation
table.

**No Tier B arithmetic reaches a chunk's identity.** `+ - * /`, `abs`, `min`, `max`, `floor`,
`round` and the bitwise operators are the whole of what runs in `chunks.ts`; `core`'s noise is Tier
A by its own header. `Math.sin` appears exactly twice in this exhibit — the travelling swell in
`terrain.ts` and the beacon's pulse in `things.ts` — and both are marked `@tier-b`, both are in
`@art` modules, and neither is ever hashed or stored. So "the same tomorrow" also means the same on
another engine.

## What is kept, and what is not

| | |
|---|---|
| a chunk | `16 × 16` `Uint16`s — biased elevation in the low byte, biome ordinal above it. 512 bytes |
| the ceiling | **256 chunks, a flat 128 KiB**, which is two numbers a visitor can multiply against the HUD |
| eviction | oldest-resident first, never a chunk wanted this frame |
| the scatter | **not stored.** Which tile grows a tree is two hashes, rolled while drawing |
| the border row | **not stored.** A chunk's far edge reads its neighbor, and the two agree because both are the same pure function |

## Where the frame goes

Culling is not an optimization here; it is the reason the frame is finite at all. Screen x depends
on `gx − gy` alone and screen y on `gx + gy` alone, so a screen rectangle is exactly a pair of
intervals in those two sums — which makes the cull exact rather than conservative, and makes the
horizon a straight line across a projection that does not have one.

The cost of a frame is reported in the HUD as **the worst frame of the last ten seconds**, never an
average: 16 ms mean with every eighth frame at 40 ms is a visible stutter and a healthy-looking
number, and that is exactly the shape a minting hitch has.

## The line split

`npm run gallery -- endless`, on the measure `docs/GALLERY.md` defines:

| | modules | code lines |
|---|---|---|
| **logic** | `chunks.ts` 85, `main.ts` 92, `hud.ts` 18 | **195** |
| **art** | `things.ts` 227, `terrain.ts` 85, `sky.ts` 31, `palette.ts` 24, plus 66 of CSS and markup | 433 |

69% art, against a cap of 200 on the logic half.
