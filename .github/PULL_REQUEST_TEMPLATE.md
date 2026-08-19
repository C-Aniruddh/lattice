<!--
The rules are in AGENTS.md and they apply to everyone. This template is short on purpose;
delete any line that does not apply rather than answering it with "n/a".
-->

**What changed, and why.** The why is the part a reviewer cannot reconstruct — say what breaks
without it.

**The test that would fail without this.** Name it. For a bug fix, the failing test comes first.

**Anything you did not do**, and what you would do next.

---

- [ ] `npm run verify` is green
- [ ] One thing. A PR that fixes a bug and tidies an unrelated file is two PRs
- [ ] No new dependency, and no asset file
- [ ] Every new export is in `.lattice/kit.json` and documented with a *why*
- [ ] If it is visible, `npm run dev` and someone looked at it — green is not evidence
