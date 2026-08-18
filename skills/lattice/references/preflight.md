# Preflight

Four checks, before a single file is written. One of them can end the run; two of them may ask a
question, and both of those have a third case for when nobody is there to answer.

Run all four **first**, then say one thing. Do not narrate the checks one at a time — a user
watching four green ticks scroll past has learned nothing and waited for it.

---

## 0. First, work out whether anyone can answer you

Not a check on the machine. A check on the **conversation**, and it decides what the other checks
are allowed to do. Two of them would otherwise ask a question, and a question asked where nobody
can answer does not pause the run — it *ends* it.

That is not hypothetical. In this project's first blind validation run, an agent ran this
preflight correctly, found no browser, printed the consent sentence exactly as written, and
stopped. It built nothing. The invocation was single-turn: there was no second turn for an answer
to arrive in, and the run had been designed on the assumption that there always is one.

### Do not use a TTY check

It is the obvious signal and it is wrong, in the direction that quietly deletes the question
everywhere. `test -t 0` reports on the *subprocess your shell tool just spawned*, not on the
session. Measured on the same machine:

| | `test -t 0` | actually interactive |
|---|---|---|
| Claude Code, a human typing | **no** | yes |
| `codex exec "…"`, no human at all | **no** | no |

A TTY test cannot tell those apart, and taking its word for it would mean never asking anyone
anything. Both cases read "not a tty" because in both cases stdin is a pipe.

### Ask only on positive evidence that someone is listening

Invert the default. Do not try to prove nobody is there — that cannot be done. Prove that
*somebody is*, and when you cannot, take the third case. Being wrong then costs a question that
went unasked; being wrong the other way costs the entire run.

Evidence, cheapest first:

```bash
env | grep -E 'CLAUDE_CODE_ENTRYPOINT|CODEX_CI|^CI='
```

| what you see | read it as |
|---|---|
| `CLAUDE_CODE_ENTRYPOINT=cli` | interactive Claude Code — **someone is there** |
| `CLAUDE_CODE_ENTRYPOINT=sdk-cli` | `claude --print`. Single turn — **nobody is there** |
| `CODEX_CI=1` | `codex exec`. Single turn — **nobody is there** |
| `CI=true` | a pipeline — **nobody is there** |
| none of the above | **unknown, so treat it as nobody** |

And one signal no environment variable carries, which usually settles it before you run anything:
**how did this turn start?** A whole task delivered in one argv-shaped instruction, with the game
idea and the constraints already in it, is a single-turn invocation. A person saying a sentence
and waiting is not. If the entire job arrived at once and nothing has come back since, assume
nobody is there.

**Whichever way it lands, it changes only whether you *ask*. It never changes whether you
*warn*, and it never stops you building.**

---

## 1. Node and npm — the one hard requirement

```bash
node --version && npm --version
```

The floor is **Node 20.19.0**. Anything older, or `node: command not found`, and you stop.

The message names the installer, not a command. They are not going to run a command; that is the
whole point.

> To make a game I need a free tool called Node installed on this computer. It takes about two
> minutes: go to **https://nodejs.org**, click the big green button, run what it downloads, then
> come back here and say "done".

Nothing else. No version string, no `nvm`, no "your version is 18.17.0 but 20.19.0 is required".
If they come back and it still is not there, say it once more with the same words and offer to
wait. Never paste a shell one-liner for them to run.

This is the one check with no third case. Without Node there is nothing to build, so a headless
run stops here too — and says so as its whole output.

---

## 2. A folder to build in

```bash
pwd && ls -A | head -30
```

| what you find | what you do |
|---|---|
| empty, or only `.git`, `.DS_Store`, `README.md`, `LICENSE`, `.gitignore` | build here. Say nothing |
| a folder with their stuff in it, **and someone is listening** | ask once, below |
| a folder with their stuff in it, **and nobody is listening** | **make the subfolder and say so.** Do not ask, do not stop |
| not writable (`touch .lattice-write-test` fails) | make a folder in their home directory instead and say where |

The one question, when the folder has their files in it and somebody can answer:

> This folder already has files in it. I'd rather not put a game on top of them — shall I make a
> new folder called **`lighthouse`** right here instead?

Name the folder after their game, not `my-game`. If they say yes, `mkdir` it and `cd` in. If they
say build here, build here — it is their folder.

When nobody can answer, take the answer that cannot destroy anything: `mkdir lighthouse && cd
lighthouse`, and one line in the final report saying where the game went and why. The question
existed to protect their files, and building in a subfolder protects them without needing an
answer. **Never** scaffold in place over someone's files on the strength of a question nobody
heard.

---

## 3. Can you look at it? — the check this whole preflight exists for

**Why this one matters more than the others.** Without a way to open what you built, Lattice's
tenth rule bites: *green is not evidence*, and this project has already shipped a suite that
passed over a completely black screen.

**But the question is whether *any* instrument is reachable, not whether one particular one is.**
The earlier version of this file tested for the Claude in Chrome extension and, finding none,
warned that the game could not be looked at. On the machine where that was tested, Chrome was
installed and a script could drive it perfectly well. The agent disagreed with the check, looked
anyway, and caught four defects no compiler could see. **The check was wrong, and it was wrong in
the pessimistic direction.**

So: walk the ladder in `references/looking.md` and stop at the first rung that answers.

```bash
# rung 1 — a native browser tool
ToolSearch: select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__tabs_create_mcp

# rungs 3 and 4 — a browser on the machine, which is nearly always the answer
ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
   /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium \
   /usr/bin/chromium-browser /snap/bin/chromium "$CHROME_PATH" 2>/dev/null | head -1
```

| what comes back | what it means | what you say |
|---|---|---|
| tool schemas | rung 1 | **nothing.** Go to step 2 of the parent skill |
| no schemas, but a browser path | rungs 3 and 4 | **nothing.** Go to step 2. You can look, and you do not need permission to run a script |
| no schemas and no browser | no instrument | warn — below |

Only the third row produces a warning, and it should be rare. A machine with a browser needs no
question asked of anybody, which is why S15 mattered more than it looked: **the fix removes the
consent question from almost every run rather than improving it.**

### When there really is no instrument

**Somebody is listening** — warn, ask once, and wait. Verbatim:

> I can build your game, but I won't be able to open it and look at it — there's no browser on
> this machine for me to drive, and a game nobody has looked at has a habit of being a black
> screen that compiles perfectly. Want me to go ahead anyway?

- **They say yes** → build. Say nothing further until the very end, where you tell them once,
  plainly, that you have not seen it.
- **They say no, or ask how to fix it** → one short paragraph, then wait:

  > Install Google Chrome from **https://google.com/chrome** and say "ready" — then I can open
  > the game and check it myself. Or say "go ahead" and I'll build it blind.

- **They say something ambiguous** → treat it as yes and get on with it.

**Nobody is listening** — warn and **proceed in the same breath**. Do not ask. State it once, at
the start, as a fact about the run rather than a request:

> No browser on this machine, so I'm building this without ever being able to look at it. Going
> ahead anyway — I'll say so again at the end.

Then build the whole game, and put it in the final report in plain words:

> One thing you should know: there was no browser on this machine, so **nobody has looked at this
> game** — not me, not anyone. It compiles and the server is running at http://localhost:5173.
> Open that and tell me what you see; the first thing to check is whether there is a picture at
> all.

**Do not refuse to build, in any of the three cases.** A user without a browser still gets a
game. They get one nobody has looked at, and they were told that is what they were getting, twice.
That is the whole contract.

---

## 4. git — a mention, not a check that blocks

```bash
git --version
```

Missing, and you proceed. Mention it exactly once, folded into something else, and never again:

> (No `git` on this machine, so there's no undo history — worth installing later if you want to
> keep versions.)

Never install it, never offer to, never bring it up a second time.

---

## What you say after all four

One line, then start. Not a report.

> Right — Node's here and I can see the browser. Building you a lit world: a fogged coast, a
> lighthouse you rebuild piece by piece, and a beam that pushes the fog back as it grows.

If you are on rung 3 or 4 rather than rung 1, that line is unchanged. You **can** see it; the
instrument is your business and not theirs. If there was no instrument at all, the line loses its
middle clause and gains the one sentence from step 3. Either way, do not re-litigate it.
