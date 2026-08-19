# From one sentence

**Three games. Three vendors' agents. One sentence each, an empty directory, and no access to
this repository.**

Everything else in this repo was made by people and agents who could read it. These three were
not. Each was given a single sentence describing a game, a machine with Node on it, and the
Lattice plugin. Each installed `@latticekit/*` **from the public npm registry**, scaffolded
itself, wrote the game, and looked at the result in a browser. Nobody here reviewed the design,
chose the palette, named a file, or fixed a bug.

That is the whole claim, and it is the reason this directory exists as a *record* rather than as
three more exhibits.

---

## The three

| directory | title | agent | dev port | packages used | source |
|---|---|---|---|---|---|
| `chime-path/` | **Chime Path** | Claude | **5210** | audio, core, draw, input, iso, loop, persist, ui | 1,341 lines over 6 modules |
| `evenfall-orchard/` | **Evenfall Orchard** | Codex | **5211** | core, draw, input, iso, loop, persist, sim, ui | 73 lines in one module |
| `before-the-bell/` | **Before the Bell** | Grok | **5212** | audio, core, draw, input, iso, loop, ui | 1,482 lines over 9 modules |

The directories are named for the games rather than for the vendors, because the vendor is
metadata and the game is the identity. Which agent built which is in the table above and in
each game's `package.json` `name` field, which still says `claude`, `codex` or `grok` — that is
what the scaffold wrote, and it has not been changed.

### The exact sentence each was given

Verbatim, with nothing before or after it. None of them names Lattice, isometric anything, or a
package.

> **Chime Path** (Claude)
> *a game where you hang chimes along a mountain path and tune each one, so the wind plays them
> in order as walkers pass*

> **Evenfall Orchard** (Codex)
> *a game where you plant an orchard and each evening choose to harvest or let it grow, and it
> keeps growing while the tab is closed*

> **Before the Bell** (Grok)
> *a game where you place stalls and open gates to pull the crowd to your bakery before the
> market closes*

`transcripts/PROMPTS.md` holds the round-three brief these came from, including which packages
each sentence was designed to force and which documented traps it was expected to walk into.
`transcripts/*.log` are the sessions themselves.

---

## What was verified, by hand, at the time

- **Chime Path** hangs and tunes chimes. Tap the trail to hang one, tap it again to tune it; the
  wind sweeps the path in gusts and rings them in hanging order.
- **Evenfall Orchard**'s offline growth was confirmed *by actually closing the tab* for three of
  its sixty-second days and reopening — it said **"While you were away, the orchard grew for 2
  days"**. This is the one prompt that cannot be satisfied without the tab really closing.
- **Before the Bell** places stalls and opens gates, and the crowd re-routes around them, with a
  countdown to the bell.

All three still build and serve today. All three render, move, and log a clean console under
`tools/looking/look.mjs`.

---

## The source is unedited

**Not one line of any game's `src/`, `index.html`, `tsconfig.json` or lockfile has been changed.**
Their value is precisely that nobody designed them and nobody polished them. An agent got one
sentence and produced this; editing it destroys the thing being demonstrated.

Exactly one thing was changed, in all three, and it is recorded here rather than quietly done:

> **The `--port` number in the `dev` script.** Chime Path shipped on 5183 and the other two both
> shipped on 5173 — three games that could not run at the same time, two of them colliding with
> the demo. They are now 5210, 5211 and 5212. Nothing else in any `package.json` was touched:
> not the name, not the dependency list, not the versions, not the other scripts.

### Keep the registry dependencies

Each game's `package-lock.json` resolves every `@latticekit/*` to
`https://registry.npmjs.org/@latticekit/<name>/-/<name>-0.1.0.tgz`. **Do not convert these to
`workspace:*`.** The npm-installed package at the version a stranger's install produced *is the
artifact*. Rewriting the dependency to a local path would turn these into ordinary in-repo
examples and destroy the claim they exist to support.

If `node_modules` is missing, `npm install` inside the game — from the registry, which is the
point.

---

## The known defects, which stay

A record that hides its blemishes is not a record. These are real, they were found after the
fact, and they are **left in**.

### Evenfall Orchard goes near-black for part of its day

At one phase of the sixty-second day cycle, **84% of the frame is a single near-black color**
(`#181820`, 98% of the border, mean luminance 0.021). It is measurable on demand — six
consecutive looks land on 73%, 42%, 84%, 84%, 76%, 76%. Its author verified the game at *"Dawn
mist"*, where it looks lovely, and a phase that arrives thirty seconds later was never seen.

This is a looking-loop failure, not a rendering bug: the agent looked, and looked at the right
thing, at the wrong moment.

### Chime Path ships HUD text under the contrast floor

Five HUD text nodes measure **1.58 to 2.53 contrast** against their own backdrop — every row
under the 4.5 WCAG AA floor. At the opening frame the harness names *"the path is silent"* at
**2.53** (under the 3.0 hard floor) and *"Tap the trail to hang a chime"* at **3.1**; the lower
readings belong to later states of the HUD.

The agent that built it **drove a browser and still missed them**, which is the interesting part.
Low contrast reads as *atmosphere* over a beautiful world, so an eye that is looking for defects
does not register it as one. That is the argument for a number over an opinion, and it is written
up as task `S17` in `.lattice/tasks.json`.

---

## What these are not

They are **not gallery exhibits**. They are not bound by `docs/GALLERY.md`'s line rule, its
§ Scale, or its art/logic split, and `npm run gallery` does not count them — the gallery is
nineteen exhibits and stays nineteen. A rule that exists to shape work done inside this
repository cannot be applied to work done outside it without changing what the work was.

---

## Not npm workspace members, deliberately

`from-one-sentence/*` is **not** in the root `package.json` `workspaces` array, and should not be
added to it.

**The tension is real, so here is both sides.** Being a workspace member is how a directory gets
built and tested by the repo's gate; not being one means these three are outside `npm run
verify`, and something outside the gate can rot without anyone noticing.

**Membership loses anyway, for a reason specific to these three.** The root workspace already
contains packages named `@latticekit/core`, `@latticekit/iso` and the rest. If these games joined
it, npm would resolve those specifiers to the **local** `packages/*` directories rather than to
the registry tarballs in their own lockfiles — silently, as a side effect of a root `npm install`.
That is exactly the conversion the section above forbids, arriving through the back door. The
artifact would stop being *what a stranger's install produces* and become *what this repository
happens to contain today*, and no one would see it happen.

The cost is accepted with mitigations:

| the cost | what covers it |
|---|---|
| not built by `npm run verify` | each has its own `npm run build` (`tsc --noEmit && vite build`), and all three pass today |
| not typechecked by `tsconfig.check.json` | each has its own `tsconfig.json` and its own `npm run check` |
| not covered by `vitest` | none of them wrote tests. They are a record of what one sentence produced, and adding tests would be editing them |
| could rot silently | that is the honest residual risk. It is the price of the dependencies staying real |

They are also, by consequence, invisible to `npm run lint` — which is correct. The eleven
non-negotiables govern code written *inside* this repository by people who can read them. These
three were written by agents who could not.

---

## Running them

```bash
cd from-one-sentence/chime-path       && npm install && npm run dev   # → localhost:5210
cd from-one-sentence/evenfall-orchard && npm install && npm run dev   # → localhost:5211
cd from-one-sentence/before-the-bell  && npm install && npm run dev   # → localhost:5212
```

`npm install` is only needed if `node_modules` is absent; it installs from the public registry.
To look at one the way the harness does:

```bash
node tools/looking/look.mjs http://localhost:5211
```

Evenfall Orchard and Before the Bell each carry their own vendored copy at `tools/look.mjs`,
which is what their agent used at the time. Neither has been updated to match the repo's copy,
for the same reason as everything else here.

## Layout

```
from-one-sentence/
  README.md            this file
  chime-path/          Claude's game, as built
  evenfall-orchard/    Codex's game, as built
  before-the-bell/     Grok's game, as built
  transcripts/         PROMPTS.md and the three session logs
```

None of the three wrote a `README.md` of its own; one that had would have kept it as written.
`.look*/` directories hold the frames each agent captured while looking at its own work — the
games' own `.gitignore` files exclude them, which was also the agents' choice and is also kept.
