#!/usr/bin/env node
/**
 * Two guards over `look.mjs`, both of which exist because of a failure that already happened.
 *
 * **The drift guard.** `look.mjs` lives twice: once here, where it is the source of truth, and
 * once at `skills/lattice/references/look.mjs`, where it ships. The second copy is not an
 * indulgence — a skill's constraint is that the user has `node_modules` and not this repository,
 * so anything a skill tells an agent to run has to travel inside the skill. Two copies of a file
 * are two files that drift, and the drift is silent: the repo's tests would go on passing
 * against a harness no user is running. So the copies are compared, byte for byte, here.
 *
 * **The fixture guard.** Ten pages, six of them broken in a way a real agent shipped, and the
 * assertion is not "the script ran" but *which row failed*. A harness that fails everything is
 * as useless as one that passes everything, and the second one is how this project got a suite
 * that was green over a black screen. `good` must pass every row; each broken page must fail
 * exactly the row named for it and no other. One page is looked at **twice, at two hours**,
 * because one of those six is only broken at one of them.
 *
 * Two of the ten are pinned on their **detail text** rather than on their verdict, because what
 * they prove is that a page which is *nearly* illegible is not reported as broken. See `dimhud`
 * and `largehud` below.
 *
 * ```bash
 * node tools/looking/verify.mjs
 * ```
 *
 * Impure: spawns browsers, reads the disk.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { judge, look } from './look.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const fixture = pathToFileURL(join(here, 'fixture.html')).href;

/**
 * The `cycle` fixture is a sixty-second day read off the wall clock, bright at phase 0 and
 * near-black at phase 0.5. `aim(ms)` returns the `--advance` that lands the *capture* on a chosen
 * millisecond of that minute — the capture, not the launch, so the lead is the browser start plus
 * the settle. The dark half of the cycle is flat for about twenty seconds either side of the
 * bottom, so a couple of seconds of error changes nothing.
 */
const CAPTURE_LEAD_MS = 2300;
const aim = (targetMs) => ((targetMs - ((Date.now() + CAPTURE_LEAD_MS) % 60_000)) % 60_000 + 60_000) % 60_000;

/**
 * What each fixture is supposed to prove. `fails: []` means every row passes.
 *
 * `darkroofs` is in the table with an empty expectation on purpose. It is the defect this
 * harness does **not** catch — a roof painted in the outline slot, near-black against a night
 * sea — and it is pinned here so that nobody later reads the passing matrix as a claim that it
 * does. If a future measurement catches it, this line is what changes.
 *
 * The two `cycle` rows are the S16 pin. **The same page, the same build, two verdicts**, and the
 * only difference between them is the hour `--advance` put the page in. A regression that stopped
 * the flag reaching the page's clock would show up as the dark row passing — which is exactly the
 * failure this whole file exists to catch, an author's verdict taken at the hour that flattered.
 */
const EXPECTED = [
  { mode: 'good', fails: [] },
  { mode: 'blank', fails: ['anything', 'framing', 'motion'] },
  { mode: 'diorama', fails: ['framing'] },
  { mode: 'blackhud', fails: ['legibility'] },
  { mode: 'static', fails: ['motion'] },
  { mode: 'throws', fails: ['console'] },
  { mode: 'darkroofs', fails: [] },
  { mode: 'cycle', label: 'cycle@noon', advance: () => aim(0), fails: [] },
  { mode: 'cycle', label: 'cycle@night', advance: () => aim(30_000), fails: ['framing'] },
  // The two that pin the contrast decision, and they pin a *refusal* as much as a behavior.
  //
  // Both pages are `#767676` on `#1c2230` — **3.59**, between this harness's floor of 3 and
  // WCAG AA's 4.5. Raising the floor to AA was considered and rejected on measurement: 660
  // readings across this kit's eleven exhibits and three games built blind put `endless` at 3.26
  // and the whole of `crowd`'s label row at 4.16, so AA would redden two exhibits nobody thinks
  // are broken. `dimhud` is what that refusal looks like — a **pass**, with the shortfall named in
  // the detail so an author is told without being alarmed.
  //
  // `largehud` is the same ink, the same ground and the same 3.59 at 28 px, where WCAG's large-text
  // rule makes 3 the AA floor. It must pass **and say nothing**, which is the only place the size
  // distinction does any work: it is not in the failing threshold, where every measured node in the
  // band is 9 to 15 px and the rule would be inert.
  {
    mode: 'dimhud',
    fails: [],
    legibility: /^5 text nodes, all readable — 5 above the floor and under WCAG AA \(4\.5, or 3 at 24px \/ 19px bold\): /,
  },
  { mode: 'largehud', fails: [], legibility: /^5 text nodes, all readable$/ },
];

let failures = 0;

const left = readFileSync(join(here, 'look.mjs'));
const right = readFileSync(join(repo, 'skills', 'lattice', 'references', 'look.mjs'));
if (!left.equals(right)) {
  failures++;
  process.stdout.write(
    'DRIFT  tools/looking/look.mjs and skills/lattice/references/look.mjs differ.\n' +
      '       The first is the source. Copy it over the second and commit both.\n',
  );
} else {
  process.stdout.write('ok     the shipped copy of look.mjs matches the source\n');
}

for (const { mode, fails, label, advance, legibility } of EXPECTED) {
  const name = label ?? mode;
  const report = await look({
    url: `${fixture}?mode=${mode}`,
    out: null,
    evals: [],
    at: [],
    advanceMs: advance ? advance() : 0,
    json: false,
    settleMs: 900,
    gapMs: 700,
    width: 1280,
    height: 800,
  });
  const rows = judge(report);
  const actual = rows
    .filter((row) => row.verdict !== 'pass')
    .map((row) => row.name)
    .sort();
  const expected = [...fails].sort();
  const same = actual.length === expected.length && actual.every((name, i) => name === expected[i]);
  if (same) {
    process.stdout.write(`ok     ${name.padEnd(12)} failed [${actual.join(', ')}]\n`);
  } else {
    failures++;
    process.stdout.write(
      `BAD    ${name.padEnd(12)} expected [${expected.join(', ')}], got [${actual.join(', ')}]\n`,
    );
  }
  // The advisory has no verdict, so a matrix that reads only verdicts cannot see it — which would
  // leave the one thing `dimhud` exists to prove untested.
  if (legibility) {
    const detail = rows.find((row) => row.name === 'legibility')?.detail ?? '';
    if (legibility.test(detail)) {
      process.stdout.write(`ok     ${name.padEnd(12)} legibility detail matches\n`);
    } else {
      failures++;
      process.stdout.write(
        `BAD    ${name.padEnd(12)} legibility detail did not match ${legibility}\n` +
          `       got: ${detail}\n`,
      );
    }
  }
}

process.stdout.write(failures === 0 ? '\nall good\n' : `\n${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
