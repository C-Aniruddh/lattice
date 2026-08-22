# Security

Lattice is maintained by one person. That is the honest constraint behind every number on this
page, and it is why there is no SLA on it.

## Reporting a vulnerability

**[Open a private advisory](https://github.com/C-Aniruddh/lattice/security/advisories/new)** —
GitHub's private vulnerability reporting is enabled on this repository, so the report, the
discussion and the draft fix all stay between us until there is a release. Please do not open a
public issue for anything that would give someone a working exploit before there is a fix.

Include whatever you have. The most useful report here is the same one the rest of the project
asks for: **the reproduction is the report.** Because the kit is deterministic, a seed plus an
input log is enough to reproduce anything — which is precisely why determinism is rule one.

- what an attacker gets, in one sentence
- the package and version (`@latticekit/<name>@<version>`), or the plugin and the agent it ran in
- a reproduction — a seed, the inputs, a snippet, or a repository
- what you expected to happen instead

## What to expect

| | |
|---|---|
| acknowledgement | usually within a few days. If a week passes with silence, send it again — assume it was missed rather than ignored |
| assessment | a plain answer about whether it is a vulnerability, and if not, why not |
| a fix | as fast as the severity warrants. A patch release is cheap here: nine packages, lockstep, one number |
| credit | your name in the release notes and `CHANGELOG.md`, unless you would rather not |

There is no bug bounty. There is no embargo you are obliged to honor, though a couple of weeks
before public disclosure makes a fix likelier to exist when the report lands.

## In scope

- **The nine `@latticekit/*` packages.** Anything a caller can reach from a package's public API.
- **The `/lattice` plugin and the skills** in `skills/`, which are instructions an agent follows.
  A prompt that makes the agent do something the user did not ask for — write outside the project
  directory, exfiltrate a file, run a command the flow never describes — is a real finding here,
  and the more interesting half of this project's attack surface.
- **The build and release tooling** in `tools/`, and the workflows in `.github/workflows/`.

Things worth looking at specifically, because they are where untrusted bytes meet code:

- `@latticekit/persist` reads save data that a player can edit. It refuses a version mismatch by
  name and checks integrity, and a way past either is in scope.
- `@latticekit/loop`'s replay reads a recorded input log.
- `@latticekit/draw` derives colors from values a game may take from a URL or a save.
- Anything that turns a string from outside into a path, a property lookup, or DOM.

## Out of scope

- **A game *you* wrote on top of the kit.** Lattice does no network I/O, has no server, and
  stores nothing but what a game hands to `persist`. What your game does with player input is
  yours.
- **`from-one-sentence/`.** Those three games are a *record* of what three agents produced from
  one sentence, and their source is deliberately unedited — blemishes included. They are not
  shipped, not installed by anything, and a defect in them is a finding about the agent that
  wrote them, which is interesting but not a vulnerability. Note it in a normal issue.
- **The exhibits in `examples/`.** Same reasoning: they are demonstrations, and they are not
  published to any registry.
- **Missing hardening with no reachable exploit** — a header the landing page does not set, a
  dependency advisory in a dev dependency that never runs in a user's build. Say it in an issue
  and it will be read; it is just not a report that needs a private channel.

## Supported versions

| version | supported |
|---|---|
| `0.1.x` | yes — fixes go to the newest patch |
| anything older | no. There is nothing older |

Pre-1.0 and in lockstep: all nine packages carry one version number, a fix ships as a patch
across all nine, and the upgrade is a single number in your `package.json`.
