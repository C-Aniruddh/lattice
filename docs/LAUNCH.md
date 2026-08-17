# The launch checklist

Everything that must be true before Lattice is public, in the order it has to happen. The
ordering is not preference — most of these gate each other, and doing them out of order means
publishing something that has to be republished.

**The repository going public is deliberately near the end.** Until it does, every link on the
landing page 404s to a visitor. That is *expected state*, not a defect, and no effort should be
spent neutralizing those links — they come alive the moment the switch flips.

---

## Gate 1 — names, before anything is published anywhere

- [x] **Scope resolved.** `@lattice/*` belongs to an unrelated 2020 REST framework; the kit
      publishes under **`@latticekit/*`**. Done: 346 files, 1,494 occurrences, 2,599 tests
      before and after.
- [ ] **Claim the `@latticekit` scope on npm.** One `npm publish --access public` of any package
      reserves it. Do this before announcing the name anywhere, including in a talk or a tweet —
      a scope is first-come and the whole point of choosing a free one is undone by waiting.
- [ ] **Decide the plugin's home.** It currently sits at the repo root, so installing from GitHub
      clones the entire monorepo, and `plugin.json` validation warns that the repo's `CLAUDE.md`
      sits at the plugin root. Either `plugins/lattice/` or its own repository.

## Gate 2 — the packages are real

- [ ] **Publish all nine**, `core` first, then layer 1, then 2, then 3. A consumer installing
      mid-publish must never see a package whose dependency does not exist yet.
- [ ] **Verify the published artifact, not the workspace.** `npm pack` each, install the tarballs
      into a directory outside this repo, and compile something against them. The `files` list,
      the `exports` map, the built `dist` and the shipped `README.md` are all only exercised this
      way, and the classic failure is a monorepo where everything works and nothing installs.
- [ ] **The fallback path in `skills/lattice/references/scaffold.md` stops being load-bearing.**
      It exists because nothing is published; once things are, it becomes a genuine fallback
      rather than the primary route, and its wording should say so.

## Gate 3 — the page tells the truth to a stranger

- [ ] **The first screen says what this is.** Today 100vh of hero carries no sentence; a blind
      reviewer scrolled only because the picture was pretty. The mobile layout is currently
      *better* than the desktop one on this point.
- [ ] **The gallery stops starving visible tiles.** Eviction is not distance-ordered, so after one
      scroll away and back, tiles in the viewport sit blank while an off-screen tile holds a slot,
      and they never recover.
- [ ] **The frame-honesty guard is applied everywhere, not in one widget.** The page argues that
      `0.0 ms` means rAF stopped rather than "fast", and then ships an exhibit displaying
      `0.0 ms` and a tile displaying an unqualified `405.5 ms`.
- [ ] **Answer the adopter's questions.** Browser support floor, versioning and breaking-change
      policy, what is stable versus what is not, and one honest paragraph on why not Phaser or
      Pixi. Absent entirely today.
- [ ] **Surface the provenance to humans.** Every headline figure already carries a `source`
      string naming the command that produced it — and only `api.json` shows it. The reviewer's
      closing note: *"you built a page that wins arguments with skeptics and then pointed it at
      agents."*

## Gate 4 — the last two, in this order

- [ ] **Make the repository public.** ~25 links come alive: nav, ten gallery `SOURCE` links, eight
      footer doc links. Nothing on the page needs changing for this.
- [ ] **Run the validation session, and let it be the judge.** `docs/SKILLS.md` has specified this
      from the beginning and it is deliberately last: a new empty directory, the plugin installed
      the way a stranger installs it, packages installed from the registry, **no access to this
      repository**, one sentence describing a game, and a browser open at the end.

      Judge it on the game, not the transcript. An agent that produces plausible code and a black
      screen has failed, and this project has made that exact mistake once already.

      **Anything that run cannot do is the real backlog.** Everything above it is preparation.

---

## Not gates, but decide before or shortly after

- **The eight unbuilt exhibits.** `docs/GALLERY.md` promises eighteen and eleven exist. The page
  names the missing ones honestly rather than implying otherwise, so this is a completeness
  question and not a correctness one — but a reviewer counting will notice, and one did.
- **The API reference lists names, not signatures.** It answers "which package, which symbol" and
  never "how do I call it", because `kit.json` carries no types. Doing it properly means
  generating from the `.d.ts` files, which is a tool rather than a page change.
- **`examples/_shared/bootstrap` is not shipped**, so the `starting` skill reproduces ~120 lines
  of correct boot inline — and everything that file calls silent-when-wrong is prose again, which
  is exactly what it exists to prevent. A published `@latticekit/boot` collapses it to five lines.
- **British spellings in ~20 `packages/*/src` doc comments**, against the house rule. `npm run
  lint` does not enforce spelling, which is why they survived.
- **~60 routed kit findings** in `.lattice/tasks.json`, K29–K61. None block launch. The sharpest
  are K44 (tap coordinates are a flat-ground answer, silently wrong on terrain) and K58
  (`PathFinder`'s heuristic ignores weights, so any weighted map costs ~17×).
