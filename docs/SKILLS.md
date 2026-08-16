# The skills package

The last thing Lattice ships is a set of **agent skills** — so that someone who runs
`npm i @lattice/iso` and has never seen this repository gets an agent that is genuinely good
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
`README.md`, so `node_modules/@lattice/iso/README.md` is a real path on a user's disk and the
package READMEs are load-bearing distribution rather than repo decoration.

It also means the skills package is **distributed separately from the libraries** and
installed the way skills are installed — a plugin, a marketplace entry, or a directory a user
drops in. It must not be a dependency of any `@lattice/*` package, and no package may assume
it exists.

---

## What the skills are for

Skills are organized by **what a person is trying to do**, never by package boundary. Nobody
sits down to "use `@lattice/iso`"; they sit down to put a building where someone tapped. A
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
