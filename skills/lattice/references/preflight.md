# Preflight

Four checks, before a single file is written. Two of them can end the run; one of them asks the
only question in this flow that is not "what do you want to make".

Run all four **first**, then say one thing. Do not narrate the checks one at a time — a user
watching four green ticks scroll past has learned nothing and waited for it.

---

## 1. Node and npm — the one hard requirement

```bash
node --version && npm --version
```

The floor is **Node 20.19.0**. Anything older, or `node: command not found`, and you stop.

The message names the installer, not a command. They are not going to run a command; that is
the whole point.

> To make a game I need a free tool called Node installed on this computer. It takes about two
> minutes: go to **https://nodejs.org**, click the big green button, run what it downloads, then
> come back here and say "done".

Nothing else. No version string, no `nvm`, no "your version is 18.17.0 but 20.19.0 is required".
If they come back and it still is not there, say it once more with the same words and offer to
wait. Never paste a shell one-liner for them to run.

---

## 2. A folder to build in

```bash
pwd && ls -A | head -30
```

Three cases, and you decide which one you are in without asking:

| what you find | what you do |
|---|---|
| empty, or only `.git`, `.DS_Store`, `README.md`, `LICENSE`, `.gitignore` | build here. Say nothing |
| a folder with their stuff in it | **ask once**, below |
| not writable (`touch .lattice-write-test` fails) | make a folder in their home directory instead and say where |

The one question, when the folder has their files in it:

> This folder already has files in it. I'd rather not put a game on top of them — shall I make
> a new folder called **`lighthouse`** right here instead?

Name the folder after their game, not `my-game`. If they say yes, `mkdir` it and `cd` in. If
they say build here, build here — it is their folder.

**Never** run a scaffolder that overwrites in place without that sentence having been said.

---

## 3. Claude in Chrome — the check this whole preflight exists for

**Why this one matters more than the other three.** Without a browser you cannot open what you
built. Lattice's tenth rule is that *green is not evidence* — this project has already shipped a
suite that passed over a completely black screen. So a missing browser is not a missing
convenience; it removes the only check that actually decides whether there is a game.

### Detecting it

Look for tools whose names begin `mcp__claude-in-chrome__`. They are often deferred rather than
absent, so a name you cannot see is not proof:

```
ToolSearch: select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__tabs_create_mcp
```

If schemas come back, the extension is available — say nothing about it, and go to step 2 of
the parent skill. If nothing comes back, the extension is not connected.

### The warning, and the one question — say this verbatim

> I can build your game, but I won't be able to open it and look at it — the Claude for Chrome
> extension isn't switched on here, and a game nobody has looked at has a habit of being a black
> screen that compiles perfectly. Want me to go ahead anyway?

Then wait for an answer.

- **They say yes** → build. Say nothing further about it until the very end, where you tell them
  once, plainly, that you have not seen it.
- **They say no, or ask how to fix it** → one short paragraph, then wait:

  > Install the Claude for Chrome extension from the Chrome Web Store, switch it on for this
  > site, and say "ready". Or say "go ahead" and I'll build it blind.

- **They say something ambiguous** → treat it as yes and get on with it.

**Do not refuse to build.** A user without the extension still gets a game. They get one nobody
has looked at, and they were told that is what they were getting. That is the whole contract.

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

If Chrome was missing and they consented, that line loses its middle clause and gains nothing.
Do not re-litigate it.
