# The skills package

The last thing Lattice ships is a set of **agent skills** — so that someone who runs
`npm i @latticekit/iso` and has never seen this repository gets an agent that is genuinely good
at the kit, rather than one that guesses at it from type signatures.

This is not documentation in a different hat. The kit's hardest-won knowledge is not its API;
it is the set of things that are individually surprising and jointly the difference between a
working game and a plausible-looking broken one. An agent that knows the API and none of that
will write code that compiles, passes, and is wrong in the specific ways this project already
paid to discover.

---

## The constraint that shapes everything

**The user has `node_modules`, not the repository.**

No `AGENTS.md`. No `docs/SEAMS.md`. No RFCs, no commit history, no `.lattice/kit.json`. A skill
that says "see the constitution" is a skill that fails for everyone it was written for.

So each skill is **self-contained**: it carries the knowledge it needs inline. Where it points
at a file, that file must be one npm actually ships — every package's `files` field includes
`README.md`, so `node_modules/@latticekit/iso/README.md` is a real path on a user's disk and the
package READMEs are load-bearing distribution rather than repo decoration.

It also means the skills package is **distributed separately from the libraries** and
installed the way skills are installed — a plugin, a marketplace entry, or a directory a user
drops in. It must not be a dependency of any `@latticekit/*` package, and no package may assume
it exists.

---

## What the skills are for

Skills are organized by **what a person is trying to do**, never by package boundary. Nobody
sits down to "use `@latticekit/iso`"; they sit down to put a building where someone tapped. A
skill that mirrors the dependency graph is a table of contents, and the agent already has one.

| skill | fires when the task is | the knowledge it carries |
|---|---|---|
| **starting** | "make an isometric game", "set up a Lattice project" | the bootstrap: surface, camera, loop, input, the one wiring order that works, and `drive` rather than the wrong subscription |
| **art** | "draw a building", "make a sprite", "it looks flat" | silhouette first, detail at three scales, setback massing, window rhythm, three-tone faces from one color, cool shadows and warm highlights, something moves on everything |
| **world** | "terrain", "a road", "elevation", "walkers" | tilemaps, height on vertices, paths as curves sampled by arc length, flow fields, and why tile lookup floors |
| **economy** | "idle game", "resources", "offline progress", "prices" | production graphs, closed-form cost, capacity gating as two curves, and the offline warp that must never be restarted |
| **input** | "tap to place", "pinch zoom", "drag the camera" | the per-tick bucket, tap-versus-drag thresholds and where they came from, pointer capture, and why input never learns what is in the world |
| **sound** | "add sound", "music", "audio feedback" | declarative sounds, buses, the bed that follows one parameter, the voice ceiling, and the gesture-unlock rule |
| **saving** | "save the game", "my schema changed", "load a save" | the chain *is* the version, one rung per migration, degrade-with-a-reason on corruption, and the reset ordering that a naive clear gets wrong |
| **hud** | "show resources", "add a HUD", "a toast" | the overlay's pointer contract, state on update and never on render, latches keyed on conditions |
| **determinism** | "my replay diverges", "why is this different on another machine" | the two tiers, what may reach a save file, and the debugging order that finds a divergence fastest |
| **performance** | "it stutters", "it's slow", "frame drops" | the tail argument, out-parameters, where an isometric game's frame time actually goes, and what not to optimize |
| **traps** | *always available, low priority* | the failures that are individually surprising: two clocks, pick order versus paint order, `Readonly<Vec2>`, a hidden tab, `Infinity` through JSON, a stale `stepMs` |

Roughly eleven. The exact split is less important than the trigger phrasing: **a skill nobody's
task matches is a skill that never fires**, and the most common failure of a skills package is
that every skill is written from the author's side of the problem.

---

## What makes a skill here good

1. **It carries the trap, not the signature.** The agent can read a `.d.ts`. It cannot read
   that `Readonly<Vec2>` is assignable to `Vec2` and will let a callee write to a frozen
   constant, because TypeScript ignores `readonly` in assignability checks. That sentence is
   worth more than the whole type listing.
2. **It shows the wrong version.** Every trap in this kit was found as working-looking code.
   A skill that shows only the right answer teaches an agent to recognize the right answer; a
   skill that shows both teaches it to recognize the wrong one, which is the job.
3. **Its examples compile.** Against the published packages, not against the workspace — the
   two differ, and the difference is exactly what a user hits.
4. **It says what it does not cover** and names the skill that does.

---

## Validation: a fresh directory and a real session

The kit's tenth rule is that green is not evidence. The skills package gets the same treatment,
and it is the last task in the project:

> **Create a new empty directory. Install the kit and the skills the way a stranger would.
> Run a session that builds a small isometric game. Verify it works.**

Deliberately not a test in this repository, because this repository is the thing being
questioned. Specifics:

- **Install from packed artifacts, not from the workspace.** `npm pack` each package and
  install the tarballs. That exercises exactly what npm would publish — the `files` list, the
  `exports` map, the built `dist`, the shipped `README.md` — and it catches the classic
  failure where everything works in the monorepo and nothing works installed, which no test
  inside the monorepo can see.
- **The session gets no access to this repository.** If it needs something only found here,
  that is the finding.
- **Judge it on the game, not on the transcript.** Run it, look at it, screenshot it. An agent
  that produces plausible code and a black screen has failed, and this project has already
  made that exact mistake once.

What the run is really measuring, in order: whether the packages install and work at all
outside the workspace; whether the skills fire on a real task without being asked for by name;
whether an agent that has never seen the RFCs avoids the traps anyway; and whether the thing it
builds is any good.

**Anything that run cannot do is the real backlog.** Everything before it is preparation.

---

# Part two: the plugin, and the one command

The section above settles *what the skills know*. This one settles **how a person gets them and
what happens when they use them**, and it is a different problem with a much harder bar.

## The bar

> **A grandmother or a five-year-old installs the plugin, types their game idea, and gets a
> game.**

That is the requirement as stated, and it should be read literally rather than as enthusiasm.
It rules out, immediately and without appeal:

- asking which packages to install;
- asking whether they want TypeScript, a bundler, or a project layout;
- asking anything with a right answer the agent could have worked out;
- a first response that is a plan, a question, or a wall of choices;
- any error message whose fix is a command the user must understand.

**Every question asked of the user is a failure to have chosen a default.** The only questions
that survive are the ones where the user is the sole source of truth: what the game is about,
and consent for something the agent may not decide alone.

## The entry point is one command

```
/lattice a game where you rebuild a lighthouse and the light pushes back the fog
```

Everything after `/lattice` is the game. There is no flag, no subcommand, no mode. A user who
types `/lattice` alone gets asked what they want to make, in one sentence, and nothing else.

**One parent skill owns that command.** It is an orchestrator rather than a library: it decides
which specialist skills to load and in what order, and the specialists never fire on their own
for a from-scratch build. That inversion is the whole design — eleven skills triggering on
phrase matches is a system that works when a user says the right words, and the bar above says
they will not.

## What the parent does, in order

**1. Preflight, and it happens before a single file is written.**

| check | if missing |
|---|---|
| `node` ≥ the engines floor, `npm` | stop. This is the one hard requirement, and the message names the installer link rather than a command |
| a writable empty-ish directory | offer to make one. Never scaffold on top of someone's files without saying so |
| **Claude in Chrome** | **warn, then ask once.** See below |
| `git` | proceed without it, mention once |

**Claude in Chrome is the interesting one**, and it is why preflight exists at all. Without a
browser the agent cannot look at what it built, and this kit's tenth non-negotiable is that
*green is not evidence* — a suite that passes and a black screen is the exact failure this
project has already shipped once. So its absence is not a missing nicety, it is the removal of
the only check that matters.

The warning says that, in one sentence, and then asks the user to confirm they want to continue
blind. It does **not** refuse. A user without the extension can still get a game; they just get
one nobody has looked at, and they should know that is what they are getting.

**2. Choose the shape, and say what was chosen — do not ask.** The game idea maps to an
archetype, a starting exhibit, and a set of specialist skills. Announce the choice in one line
so a user who wanted something else can say so; do not put it to a vote first.

**3. Scaffold and install.** The skills know the package names, the layering, and the wiring
order that works. This is the step where the user would otherwise have to know that `draw`
depends on `iso`, and they must never find out.

**4. Build it, and get to a running screen as fast as possible.** A visibly working thing that
is missing features beats a complete thing that appears at the end. The first screen a user sees
should arrive in the first minute, and should already be recognizably theirs.

**5. Look at it.** Open it, screenshot it, judge it, fix what is wrong, and repeat. This is the
step the preflight was protecting, and it is not optional when the browser is present.

## What the parent must never do

- **Report success on a build it has not seen.** With Chrome available, "it compiles" is not
  done. Without Chrome, it says plainly that it has not been looked at.
- **Surface a stack trace.** Errors are the agent's problem. The user hears what is happening in
  their own words, or hears nothing.
- **Leave a dead end.** Every failure has a next action the agent takes itself.

## Distribution

A marketplace entry, installed the way plugins are installed, carrying the parent and every
specialist. It is **not** a dependency of any `@latticekit/*` package and no package may assume it
exists — the libraries have to work for someone who never heard of it.

The skills are written against **the published packages**, not this workspace, for the reason
Part one already gives: the user has `node_modules`, not the repository. The validation run is
unchanged and is still the last task in the project — a fresh directory, tarballs, no repo
access, and a judgment made by looking at the game rather than at the transcript.

## The test that decides whether this shipped

Not a checklist. One run, and it either happens or it does not:

> Someone who has never seen this repository installs the plugin, types one sentence about a
> game, touches nothing else, and ends up looking at that game in a browser.
