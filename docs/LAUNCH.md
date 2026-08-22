# The release checklist

This was a one-time pre-launch list. Launch happened: the nine packages are on the public
registry, the plugin is installable, the repository is public and the page is live. Keeping the
old gates here would have made this a second tracker disagreeing with the first, so what remains
is the part that repeats — **the order to cut a version in** — and nothing else.

**Open work lives in GitHub issues, not in this file.** If you are looking for what to do next,
that is `.lattice/tasks.json` for the agent queue and the issue tracker for everything else.

---

## The order, and why it is an order

Most of these gate each other. Doing them out of order means publishing something that has to be
republished, which is how `0.1.0` became `0.1.1` within a day.

1. **`npm run verify` is green.** Build, lint, docs, skills, tests, measured figures, gallery and
   the looking harness. Nothing below is worth starting until this passes on a clean tree.

2. **Bump the nine `package.json` versions in lockstep, and the `VERSION` constant with them.**
   `0.1.0` shipped `export const VERSION = '0.1.0'` inside tarballs that were not `0.1.0`, because
   the constant and the manifest were two facts that agreed only by hand. `tools/lint.mjs` § 7b now
   compares them and fails, so this step is checked rather than remembered — but the linter cannot
   bump them for you.

3. **Publish `core` first, then layer 1, then 2, then 3.** A consumer installing mid-publish must
   never see a package whose dependency does not exist yet. The DAG in `.lattice/kit.json` is the
   order.

4. **Verify the published artifact, not the workspace.** `npm run skills:published` installs
   `@latticekit/*` from the registry into a cache directory and compiles every skill's examples
   against them — the `files` list, the `exports` map, the built `dist` and the shipped `README.md`
   are only exercised that way. The classic failure is a monorepo where everything works and
   nothing installs.

5. **Bump the plugin.** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` carry
   their own version and the install cache is keyed by it. A skill edited without a bump reaches
   nobody who already installed.

6. **Tag it, and write the changelog entry from the diff rather than from memory.**

7. **The page redeploys itself** from `main` — but it builds without running the test suite, which
   is why `site/tools/check-measured.mjs` re-runs every command `measured.json` names as part of
   the build. A figure that cannot be reproduced fails the deploy.

## The gate that is not automatable

**Run the validation session, and let it be the judge.** `docs/SKILLS.md` specifies it: a new empty
directory, the plugin installed the way a stranger installs it, packages from the registry, **no
access to this repository**, one sentence describing a game, and a browser open at the end.

Judge it on the game, not the transcript. An agent that produces plausible code and a black screen
has failed, and this project has made that exact mistake once already.

**Anything that run cannot do is the real backlog.** Everything above it is preparation.
