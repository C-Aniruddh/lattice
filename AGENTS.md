# Lattice — how to work in this repo

**Lattice is a kit for building isometric, deterministic, zero-asset games in TypeScript.**
Nine small libraries that compose, and a real game built from nothing but them.

This file is the constitution. It is written for agents first and humans second, because
agents outnumber humans here. Read it before you touch anything. It is short on purpose.

- **What each package is** → `.lattice/kit.json` (machine-readable) and `docs/ARCHITECTURE.md`
- **What to work on next** → `.lattice/tasks.json`
- **Where the build is** → `.lattice/state.json`
- **How one work cycle runs** → `docs/LOOP.md`

---

## The ten non-negotiables

These are not preferences. A change that breaks one of these is reverted, not debated.

1. **Determinism is a feature, not an accident.** `Math.random()`, `Date.now()`, and
   `performance.now()` are banned inside every package's `src/`. Randomness comes from a
   seeded `Rng` passed in by the caller; time arrives as a parameter. This is enforced by
   `npm run lint`. A game built on Lattice must be able to replay a session from a seed and
   an input log and land on the same pixel.

   **And it has two tiers, because the language only promises so much.** ECMA-262 specifies
   `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise operators exactly. It explicitly does
   *not* require `sin`, `cos`, `pow`, `exp` or `log` to be correctly rounded, so two
   conforming engines may disagree in the last bit.

   | | arithmetic | promise | may reach |
   |---|---|---|---|
   | **Tier A** | `+ - * /`, `sqrt`, `imul`, bitwise | bit-identical on every engine | hashes, save files, replays, anything |
   | **Tier B** | `sin`, `cos`, `pow`, `exp`, `log`, … | correct to within an ulp or so | pixels only — never hashed, never persisted |

   Tier B is not banned; a cost curve is `b · r^k` and there is no honest way around that.
   It is required to **declare itself**: mark the site `@tier-b` and the linter is satisfied.
   That makes every one of them greppable, so an auditor can ask of each in turn whether it
   ever reaches a save file.

2. **`@lattice/core` has no dependencies — and neither does anything else.** Not on npm, not
   on each other except along the layering below, not on the DOM unless the package name
   says so. The entire kit installs in one `npm i` with nothing transitive.

3. **The dependency graph is a DAG, and it points one way.**

   ```
   core ─┬─▶ iso ──┬─▶ draw ─┬─▶ ui
         ├─▶ loop  │         │
         ├─▶ sim   └─────────┤
         ├─▶ persist         │
         ├─▶ input ──────────┘
         └─▶ audio
   ```

   `core` imports nothing. Nothing imports `ui`. If you need an upward import, you have
   found a design error — say so in the task, do not add the edge.

4. **Pure where it can be, impure where it must be, and the two never mix in one file.**
   A module that touches `window`, `document`, `AudioContext` or `localStorage` says so in
   its first doc line. Everything else must run unchanged in Node with no shims.

5. **Every public symbol is documented with a `why`, not a `what`.** `/** Sets the zoom. */`
   on a method called `setZoom` is worse than no comment: it costs a line and teaches
   nothing. Say what breaks if you get it wrong. The prose in this kit is a load-bearing
   part of the product — an agent reading `camera.ts` should learn why pointer-anchored
   zoom exists, not just that it does.

6. **No public API without a test that would fail if it were deleted.** Coverage targets are
   in `.lattice/kit.json`; the current floor is 90% statements per package, 100% on
   anything in `core`. Tests are behavioural. A test that asserts an implementation detail
   is a future false alarm.

7. **The hot path allocates nothing.** Anything called per-frame or per-entity takes an
   output parameter or returns a primitive. `{ x, y }` returned sixty times a second times
   four hundred sprites is a garbage collector pause with a nice API. Benchmarks live in
   `*.bench.ts` and the numbers are in `docs/PERFORMANCE.md`.

8. **Zero assets.** No images, no audio files, no fonts, no binaries anywhere in a package.
   Art is procedural (`draw`), sound is synthesised (`audio`). This is what makes a Lattice
   game a few dozen kilobytes, recolourable at runtime, and diffable in review.

9. **Errors name the caller's mistake.** `throw new RangeError('camera.zoom: expected a
   finite number > 0, got -1')`. Never a bare `Error`, never a message that only makes
   sense with the source open beside it.

10. **Green is not evidence.** Every UX-affecting change ends with the demo game actually
    running (`npm run dev`) and someone — human or agent — looking at it. The kit is judged
    by whether a game can be built from it, not by whether its suite passes.

---

## Layout

```
packages/
  core/      seeded rng, noise, math, easing, typed events, pools, formatting.  no deps, no DOM
  iso/       projection, camera, depth sort, tile maps, footprints, hit-test, pathfinding
  draw/      Canvas2D surface, colour derivation, the isometric solid kit, sprite caching
  loop/      wall-clock loop, fixed-step integration, scheduler, tweens, frame stats
  input/     pointer/keyboard/gamepad normalisation, gestures, camera controller, actions
  audio/     zero-asset WebAudio synthesis, voice limiting, buses, music
  persist/   versioned saves, migration chains, storage adapters, integrity
  sim/       idle-economy maths: cost curves, closed-form flow, offline accrual, capacity
  ui/        DOM overlay primitives — panels, toasts, number rolls. not a framework
examples/
  demo/      a complete small game, built only from the above. the kit's real test
docs/        ARCHITECTURE, PERFORMANCE, LOOP, and RFCs for anything not yet built
tools/       lint, size budget, and the scripts the work cycle runs
.lattice/    machine-readable: kit.json, tasks.json, state.json — agents read these first
```

Each package is identical in shape: `src/index.ts` re-exports the public API and is the only
entry point; `src/*.ts` are the modules; `test/*.test.ts` mirror them one-for-one.

---

## Commands

```bash
npm run verify     # build + lint + test — the gate before any commit. nothing lands red
npm run test       # vitest, whole workspace
npm run bench      # performance benchmarks
npm run dev        # the demo game, on :5173. what proves the kit works
npm run size       # per-package gzipped size against the budget in kit.json
npm run lint       # the house rules above, enforced. determinism, layering, doc coverage
```

Scope any of them to one package: `npm run test -- packages/iso`.

**If `tsc` reports only syntax errors, your type-level tests are unverified.** A single
syntax error anywhere in the program suppresses *semantic* diagnostics repo-wide — including
`TS2578 Unused '@ts-expect-error'`, which is the assertion every negative type test rests on.
So a broken bracket in one package's test file silently disarms every `@ts-expect-error` in
the kit, and they all appear to pass. This has already hidden a real bug for one agent. Get
to a clean typecheck first, then believe the type tests.

---

## House style

The bar is `foom-simple-ui`, the game this kit was extracted from: prose comments that
explain the trap, tables where a table is clearer than a paragraph, and names that a reader
guesses correctly before reading the body.

- **British spelling in prose, American in identifiers.** `colour` in a comment, `color` in
  a signature — the web platform spells it `color` and matching it is not negotiable.
- **`readonly` on every interface field that is not deliberately mutated.** `Readonly<T>` on
  every array that crosses a package boundary.

  **But know what `readonly` does not do.** TypeScript *ignores property `readonly`
  modifiers when checking assignability.* Two interfaces identical but for `readonly` are
  mutually assignable, so a `Readonly<Vec2>` flows happily into a parameter typed `Vec2` and
  the callee writes to your frozen constant. `readonly` documents intent and stops direct
  assignment through that reference; it is **not** a barrier between a read type and a write
  type. Where the distinction is load-bearing — anywhere a value may be frozen and a callee
  may use it as an out-parameter — the barrier has to be built, and `core`'s `Vec2` /
  `ReadonlyVec2` pair shows how: a phantom optional property whose types conflict in exactly
  one direction. **Import `ReadonlyVec2`; never hand-write `Readonly<Vec2>` and assume it is
  the same thing.** It is not, and the failure is a `TypeError` on the one frame that path
  executes.
- **No `any`. No non-null `!`.** A `!` is a place where the compiler was told to stop
  helping, and in the source game one of them shipped a black screen to half the players.
  If a value can be `undefined`, handle it.
- **No barrel imports inside a package.** Import from the module, not from `./index.js`, or
  you will build an import cycle you cannot see.
- **`.js` extensions on relative imports.** NodeNext resolution; TypeScript will not add them.
- **Commit messages say what changed and why, in the imperative.** `feat(iso): anchor zoom
  to the pointer, not the origin`.

---

## Working as part of the team

Agents work on **disjoint directories**, never the same file. Your task in
`.lattice/tasks.json` names the paths you own; touching anything outside them — including
`package.json`, the root configs, or another package's source — is a merge conflict waiting
to happen. If you need a change outside your paths, write it into your report and let the
orchestrator route it.

Before you finish:

1. `npm run verify` passes.
2. Your package's `README.md` shows a runnable example that you have actually run.
3. Your public API appears in `.lattice/kit.json` under your package's `exports`.
4. Your report says what you did **not** do and what you would do next.
