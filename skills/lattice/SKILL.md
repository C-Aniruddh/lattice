---
name: lattice
description: Build a playable isometric game from one sentence, end to end — scaffold, code, run it in a browser, look at it, fix it. Use when someone says they want to make a game, build a game, make an isometric/tile/city-builder/idle/incremental game, or describes a game idea and wants it to exist ("a game where you rebuild a lighthouse", "a little town builder", "an idle game about bees"). Also use for "set up a Lattice project" or "start a new game with @latticekit". Owns the /lattice command.
---

# /lattice — one sentence in, a game out

The person in front of you may never have written a line of code. They typed a sentence about a
game. Your job is to hand back a game they can see, in a browser, without asking them anything
they cannot answer.

**The sentence is `$ARGUMENTS`.** If it is empty, ask exactly this and nothing else:

> What do you want to make? One sentence is plenty.

Then stop and wait. Do not offer a menu, a list of genres, or a plan.

---

## The rule that governs every other line here

**Every question you ask is a default you failed to choose.** Two questions survive it, and
they are the only two in this whole skill:

1. **What the game is about** — you cannot know it and they are the only source.
2. **Consent for something you may not decide alone** — proceeding blind with no way at all to
   look (step 1), and writing into a folder that already has their files in it (step 1).

And a rule that governs both of those: **a question only survives if somebody can answer it.**
In a single-turn invocation there is no second turn, so a question is not a pause, it is the end
of the run — which is exactly what happened the first time this was tested. Where nobody is
listening, you take the safe answer yourself, say which one you took, and keep building. The
preflight has the detection, and the detection is *not* a TTY check.

Everything else — the packages, the language, the bundler, the layout, the art direction, the
seed, the palette, the camera, whether they want tests — you decide, you say what you decided
in one line, and you move. A user who wanted something else will tell you. A user who is asked
first is a user staring at a form.

**Never:**

- report success on a build you have not looked at. With a browser, "it compiles" is not done;
- show a stack trace, a TypeScript error, a `npm ERR!`, or a file path with a line number.
  Errors are yours. They hear what is happening in words about their game, or hear nothing;
- leave a dead end. Every failure has a next action **you** take.

---

## What you do, in order

### 1. Preflight — before a single file is written

Run the checks in **`references/preflight.md`**. It has the exact commands and the exact
sentences to say. Do not improvise the no-browser sentence; it is the one place in this flow
where a user is being asked to accept a real loss and the wording was chosen for that.

Summary, so you know the shape:

| check | if missing |
|---|---|
| **can anyone answer you?** | not a check on the machine, a check on the conversation. It decides whether the two questions below are asked at all. **Never** decide it with a TTY test |
| `node` ≥ 20.19.0, `npm` | stop. Name the installer link, never a command |
| a writable, empty-ish folder | somebody listening: offer to make one. Nobody listening: make it and say so. Never scaffold over their files silently, and never stop on the question |
| **any way to look at it** | a browser tool, *or* an MCP server, *or* a Chrome on the machine you drive yourself. Only when there is none of the three do you warn — and even then you build |
| `git` | proceed without it, mention once, never again |

The trap this table exists to close: the check used to ask whether one particular instrument was
present, and answered "no" on a machine that had Chrome sitting on it. **Ask whether any rung of
the ladder is reachable.** Almost always one is, and then there is no question to ask anybody.

### 2. Choose the shape — say it, do not ask it

Read **`references/shapes.md`**, match the sentence to one of the eight shapes, and announce it
in **one line** before you touch the disk:

> Building you a lit world: a fogged coast, a lighthouse you rebuild piece by piece, and a beam
> that pushes the fog back as it grows. Starting now.

That line exists so somebody who wanted something else can say so. It is not a request for
approval — you keep going in the same breath. No plan, no bullet list, no "does that sound
right?".

The shape decides which specialist skills you load. **Load them yourself, by name, at the step
that needs them** — they are written to be pulled by you rather than to fire on their own, and
a from-scratch build must not depend on the user saying the magic word.

### 3. Scaffold and install

Follow **`references/scaffold.md`** exactly. It contains the file set, the install command, and
— importantly — the check that the packages that arrived are the right ones. It is also where
`starting` gets loaded: read the **`starting`** skill before you write `src/main.ts`, because
the wiring order has two mistakes in it that are completely silent when you make them.

The user never learns that `draw` depends on `iso`. They never see a package name unless they
ask.

### 4. Build it — get to a running screen in the first minute

**A visibly working thing missing half its features beats a complete thing that appears at the
end.** The first screen should arrive fast and should already be recognizably *theirs* — their
lighthouse, their fog, their coast — even if nothing is interactive yet.

Order of work, always:

1. **the ground and the camera** — terrain framed so it fills the viewport (`starting`, `world`);
2. **something that moves before the player does anything** — a rotating beam, a walker, a
   drifting bank of fog. A static first frame reads as a screenshot of a game rather than a game;
3. **the one verb** — the thing the sentence says you do. Tap a stone; the tower grows a course;
4. **the readout** — what they have, what it costs (`hud`);
5. **everything else**, in whatever order the sentence implies.

Start the dev server as soon as step 1 compiles. Leave it running.

Load specialists as the work reaches them, not up front:

| you are about to | load |
|---|---|
| write the boot, the loop, the frame | `starting` |
| draw a building, a tree, a lighthouse, anything | `art` |
| put hills, roads, water or walkers in the world | `world` |
| make numbers grow, or cost something, or accrue offline | `economy` |
| make a tap place, select, drag or zoom | `input` |
| make it make noise | `sound` |
| keep progress across a reload | `saving` |
| put numbers, buttons or messages on the screen | `hud` |
| record, replay, or explain why two runs differ | `determinism` |
| respond to "it stutters" or a bad frame number | `performance` |

`traps` is always relevant and cheap; read it when something works but looks wrong.

### 5. Look at it — this is the step the preflight was protecting

This is **not optional**, and you almost certainly can. Follow **`references/looking.md`**: it
carries a four-rung ladder from a native browser tool down to a no-dependency script that drives
whatever Chrome is on the machine and prints five readings about the frame — enough to catch a
blank screen, a world lost in an empty frame, a still picture, unreadable HUD text and an
exception, **without seeing anything**. Open the page, judge it against the five things that make
a first frame good, fix one thing, look again. Repeat until it is worth showing.

Read the ladder before concluding you cannot look. The one time this was tested for real, the
agent that ignored a preflight saying "no browser" found one anyway and shipped the better game.

Only if every rung is out of reach, say so plainly, once, at the end — and say it as *nobody has
looked at this*, never as a hedge:

> One thing you should know: there was no browser on this machine, so nobody has looked at this
> game. It builds and the server is running at http://localhost:5173. Open that and tell me what
> you see; the first thing to check is whether there is a picture at all.

---

## Talking to them

Short sentences about their game. Not about the tooling.

| instead of | say |
|---|---|
| "Installing @latticekit/draw and 6 peer packages…" | "Getting the drawing kit." |
| "TS2345: Argument of type 'Readonly<Vec2>'…" | *(nothing — fix it)* |
| "The Vite dev server is listening on :5173" | "It's running — I'm looking at it now." |
| "Should I add a save system?" | *(decide. If the game has progress, it saves.)* |
| "Build succeeded ✅" | "Here it is: [screenshot]. The beam sweeps, the fog pulls back where it lands. Tap a stone to add a course." |

When you finish, hand them three things and nothing else: **the link**, **a screenshot**, and
**the one sentence that says what to touch**.

---

## When something breaks

You fix it. In order:

1. **Look at the actual failure** — the console, the terminal, the screenshot. Not a guess.
2. **Check `traps` first.** Most Lattice failures that look like a bug in your code are one of
   about twenty known ones, and they are all in there: a black screen, a tap that hits the wrong
   thing, a sprite floating above its hill, a frame counter reading `0.0 ms`, a game that gets
   slower at dusk.
3. **Change one thing, look again.** Never two.
4. **If you are three attempts in on the same symptom**, simplify the game rather than the code:
   cut the feature that is failing, get back to a running screen, say what you cut in one
   sentence, and move on. A smaller game they can see beats a bigger one they cannot.

Never hand a failure back to the user as a question. "Something's off with the lighting — give
me a second" is a sentence. "Do you want me to try X or Y?" is not.

---

## Files in this skill

| file | read it when |
|---|---|
| `references/preflight.md` | step 1, every time |
| `references/shapes.md` | step 2, every time |
| `references/scaffold.md` | step 3, every time |
| `references/looking.md` | step 5, and any time the picture is wrong |
| `references/look.mjs` | the harness `looking.md` tells you to copy into the project. No dependencies; runs anywhere there is a Chrome |
