# Contributing to Lattice

The rules are in **[AGENTS.md](./AGENTS.md)** and they apply to everyone, human or agent — the
eleven non-negotiables are not a style guide, they are the reason the kit holds together. This
file is only what is different about sending the change from outside.

By taking part you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md). Security problems go
to [SECURITY.md](./SECURITY.md), privately, not into a public issue.

## Before you open a pull request

```bash
npm install
npm run verify     # the gate. nothing lands red
npm run dev        # the demo game, on :5173. if your change is visible, look at it
```

`verify` is `build → lint → docs → skills → test → gallery → looking`, and it is the same
command CI runs on Node 20.19, 22 and 24, so a green local run and a green CI run mean the same
thing. Scope the slow parts while you work: `npm run test -- packages/iso`.

Two of those steps surprise first-time contributors, and both are doing their job:

- **`docs` compiles the TypeScript in `README.md` and `docs/GUIDE.md`**, concatenated per
  document, because a guide is a narrative and block four uses what block two built. A rename
  that breaks the front page fails here instead of being found by whoever arrived next. A block
  that is not a program opts out with ` ```ts ignore `; a block that *is* the defect — the wrong
  half of a trap — uses ` ```ts wrong `.
- **`skills` compiles every block in `skills/` against a real `node_modules`**, each block on its
  own, under the reader's compiler flags rather than this repository's. Locally it links the
  workspace; **under CI it resolves `@latticekit/*` from npm**, which means a skill that teaches
  an API added in your PR is red until that API is published. That is not a bug in the gate: the
  user has `node_modules`, not this repository. Add the export first, teach it after the release.

## What a good pull request looks like here

- **One thing.** A PR that fixes a bug and tidies an unrelated file is two PRs.
- **A test that would fail without it.** For a bug fix, write the failing test first and put it
  in the PR description.
- **Prose that says why.** Every public symbol in this kit explains what breaks if a caller gets
  it wrong. That prose is part of the product; a PR that adds an export without it is incomplete,
  and `npm run lint` will say so.
- **No new dependency.** The kit has none and intends to keep none. If you are certain an
  exception is warranted, open an issue about the dependency before writing the code.
- **No assets.** Art is drawn and sound is synthesized. A PR containing a `.png` is a PR proposing
  a different project.
- **Green is not evidence.** If the change is visible, run it and look at it, and say in the PR
  that you did.

## Adding to a package versus adding a package

Every export is a promise to keep it working. Before adding one, check whether the thing you need
composes from what is already there — and if it does not, say in the PR why it could not.

A **new package** needs an RFC in [`docs/rfc/`](docs/rfc) first: what it is for in one sentence,
the five-line example a user would write, the public surface, and what it deliberately does not
do. [`docs/LOOP.md`](docs/LOOP.md) describes how that gets reviewed.

## Changing a package's public API

Two things move with it, and a PR that forgets either is incomplete:

- **`.lattice/kit.json`.** `npm run lint` fails if a package exports a name the manifest does not
  list, which is what keeps the reference from drifting from the code.
- **`skills/`, if the change is something a game author would be taught.** The skills are the
  product; the packages are what make the agent driving them succeed.

If it breaks something already *written down* — a save file, a replay log, a shareable seed —
read [`docs/SEAMS.md`](docs/SEAMS.md) first. A change of that kind ships with a migration or it
does not ship. The versioning rules are in [`README.md`](README.md#versioning-and-what-a-breaking-change-means-here);
releases are recorded in [`CHANGELOG.md`](CHANGELOG.md), and all nine packages move together.

## Reporting a bug

The reproduction is the report. A seed, the inputs, what you expected and what happened. Because
the kit is deterministic, a seed plus an input log is enough to reproduce anything — which is
precisely why determinism is rule one.

## Working on it as an agent

Read [`AGENTS.md`](./AGENTS.md) first and `.lattice/kit.json` before any source. Agents here work
on **disjoint directories**, never the same file; if you need a change outside the paths your task
names, write it into your report rather than reaching for it.
