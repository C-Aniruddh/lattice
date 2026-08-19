# Idle

**Closed-form cost curves, buy-max, and fourteen hours of offline in one frame.** A brick-kiln
valley whose economy is `@latticekit/sim` and nothing else: the price of the next kiln is
`b · r^k` evaluated, not accumulated, and an absence is `advanceOver` applied once.

```bash
npm run build            # from the repo root — the exhibit resolves @latticekit/* to each package's dist
npm run dev --workspace=@latticekit/example-idle
# http://localhost:5187
```

Then: **Buy one** / **Buy max** to light more stacks, and **Fourteen hours away** to spend a
fourteen-hour absence in a single step. Open **knobs**, drag **offline exponent** to 1.0, and the
same absence pays out uncapped — which is the slider's wrong end, and the point of having one.

---

## Who built this, and from what

**Built by Grok**, one of three vendors' agents in the gallery's fan-out, **from
`docs/GALLERY.md` alone.** It was given its own row, the whole standard and the tools, and it was
deliberately **not** shown any existing exhibit's source.

---

## The one idea: the absence is resolved, not simulated

Fourteen hours of wall clock credits about 7.9 hours at the default exponent, and it arrives in
**one** `advanceOver` — one phase, no crossing, no loop of ticks and no loop of boundaries. Coin
goes from about 246 to about 215,210 between two frames. The button beside it is a live readout of
what fourteen hours *would* credit, so dragging the exponent moves a number before you spend it.

The price side is the same shape: `costOfNext`, `bulkCost` and `maxBuyable` are closed forms, so
"buy the most I can afford" is arithmetic rather than a search. Source is 1.2 coin/s plus 0.8 per
kiln; price is `18 · 1.15^k`; the offline curve is the kit default — three hours uncapped, an
exponent of 5/8, flat after twenty-four.

The exponent slider steps in 64ths on purpose. A dyadic rational with a denominator of 64 or under
makes the credited time **Tier A** — bit-identical on every engine — and 0.6 versus 0.625 is three
per cent of reward and a whole determinism tier apart. You can watch the tier change as you drag
past it.

## Where `docs/GALLERY.md` made its author guess

Kept verbatim. The agent's framing: *"This is the half that matters as much as the exhibit. I was
building* from *the spec, not as its author."*

- **Where the exhibit lives.** The spec assumes `examples/<name>` next to `examples/_shared`. This
  run was "in this directory", which contained only `GALLERY.md`. I copied `_shared` in and did not
  count it. The spec never says how a standalone exhibit obtains the bootstrap or the panel.
- **Two looking harnesses.** The task pointed at `tools/looking/look.mjs`; the lattice skill tells
  you to copy `references/look.mjs` to `tools/look.mjs`. They are different files. I used the
  kit's.
- **Fourteen hours — how does the visitor see it?** The row says "fourteen hours of offline in one
  frame". The panel section says "drag the offline exponent to 1.0 and watch a fourteen-hour
  absence pay out uncapped". It never says whether that absence is a real tab-close, a button, a
  slider or a URL parameter. I guessed: a labelled button, plus a live "14h would credit Xh" line.
- **Persist.** The idle *shape* skill installs `@latticekit/persist`. Island's `package.json`
  claims the gallery forbids state that outlives the tab; `GALLERY.md` itself never says that — it
  forbids endings, meta-progression and settings screens. I skipped persist. Migration is the
  persist exhibit; the button *is* the offline demo.
- **`advanceOver` versus a loop.** The economy skill's hydrate example *does* loop
  (`solveCrossingOver` until no crossing). The brief said not a loop that ticks fourteen hours. I
  used one `advanceOver` with a single phase, because nothing here hits zero. The spec does not
  distinguish "loop of ticks" from "loop of boundaries".
- **Buy-max.** The exhibits table names it; the brief sentence did not. I shipped it, because the
  table is the row's contract.
- **What "hundreds" counts.** *"Whatever the exhibit repeats."* For Idle, is that kilns you own
  (8), kiln plots (hundreds), or every standing thing? I counted sorter survivors (537). The eight
  you own are the economy; the hundreds are the yard.
- **The 14-hour span on the panel.** *"Nothing in the panel is exhibit-specific plumbing."*
  Fourteen hours is exhibit-specific; `OfflineCurve.exponent` is a kit parameter. I put 14h in the
  HUD and the curve on the panel. The spec does not say whether the span itself should be a knob.
- **1440×900.** The scale table is that viewport. The harness default is 1280×800, and
  `--size 1440x900` became **1440×813**. The spec does not say which instrument's rectangle counts.
- **60 fps on a mid laptop.** Headless Chrome here read ~33 ms against a ~28 ms cadence. The spec
  does not say how an agent scores a headless run against a laptop gate.
- **The line-rule command versus `tools/gallery.mjs`.** The document's two-line grep gave 158. The
  kit's `gallery.mjs` is stricter — header-only `@art`, CSS counted only for the ratio — and they
  can disagree. I never ran `gallery.mjs` against this folder, because it only walks `examples/`.
- **The world is unspecified.** The one idea is the math. There is no setting, palette or verb
  beyond buy and away. I chose a kiln valley so that buying is fire spreading from the opening
  heart, and away is a smoke burst. That is invention, not spec.
- **World tap versus HUD.** Builder is the placement row. I guessed the verb lives on the HUD and
  the world is drag-to-look.
- **`?cost=0` / the embed contract.** The spec describes an embedder that does not exist in this
  directory. I still wired `costNode` and left the cost on by default.

## The numbers it reported

| | |
|---|---|
| logic / art | **158 logic** (`main.ts` 64, `rules.ts` 53, `hud.ts` 41), 392 art plus 83 of CSS |
| density | 537 sorted items in the opening frame |
| motion | 13% of pixels in one second — smoke, carts, coin |
| framing | 9% modal, 1% of the border |
| 14 h at exponent 0.625 | 28,285 s credited (~7.86 h), in one step |
| 14 h at exponent 1.0 | the identity — fourteen hours credited, which is the wrong end |

## What changed when it moved into the repository

**One thing, and it is the finding the fan-out was built to produce.** The vendored `_shared/`
beside `src/` is gone and the imports resolve to the real `examples/_shared`. The copy was a
strictly *older* snapshot of the same files — byte-identical except for `bootstrap.ts`, which was
**50 lines shorter and had no `terrain` at all**: no `BootOptions.terrain`, no `Boot.terrain`, no
`Boot.setTerrain`. Nothing was forked; it was stale.

That is why this exhibit could not declare its ground and now does. `land.ts` builds a real height
field — the kiln valley steps down to water — so the declaration is
`{ field, maxHeightPx }` rather than `'flat'`, and it is made through `boot.setTerrain` after the
map exists, which is what `bootstrap` documents that method for.

The Vite config's absolute `@latticekit/*` aliases into a plugin install directory are also gone:
in the workspace the packages resolve through their symlinks to each package's `dist`, which is
what a visitor who installed the kit gets.
