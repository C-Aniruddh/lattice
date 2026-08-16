# Contributing to Lattice

The rules are in **[AGENTS.md](./AGENTS.md)** and they apply to everyone — the ten
non-negotiables are not a style guide, they are the reason the kit holds together.

## Before you open a pull request

```bash
npm install
npm run verify     # build + lint + test. nothing lands red
npm run dev        # the demo game. if your change is visible, look at it
```

## What a good pull request looks like here

- **One thing.** A PR that fixes a bug and tidies an unrelated file is two PRs.
- **A test that would fail without it.** For a bug fix, write the failing test first and put
  it in the PR description.
- **Prose that says why.** Every public symbol in this kit explains what breaks if a caller
  gets it wrong. That prose is part of the product; a PR that adds an export without it is
  incomplete, and `npm run lint` will say so.
- **No new dependency.** The kit has none and intends to keep none. If you are certain an
  exception is warranted, open an issue about the dependency before writing the code.
- **No assets.** Art is drawn and sound is synthesised. A PR containing a `.png` is a PR
  proposing a different project.

## Adding to a package versus adding a package

Every export is a promise to keep it working. Before adding one, check whether the thing you
need composes from what is already there — and if it does not, say in the PR why it could not.

A **new package** needs an RFC in `docs/rfc/` first: what it is for in one sentence, the
five-line example a user would write, the public surface, and what it deliberately does not
do. `docs/LOOP.md` describes how that gets reviewed.

## Reporting a bug

The reproduction is the report. A seed, the inputs, what you expected and what happened.
Because the kit is deterministic, a seed plus an input log is enough to reproduce anything —
which is precisely why determinism is rule one.
