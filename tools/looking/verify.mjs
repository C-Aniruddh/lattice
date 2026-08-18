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
 * **The fixture guard.** Six pages, five of them broken in a way a real agent shipped, and the
 * assertion is not "the script ran" but *which row failed*. A harness that fails everything is
 * as useless as one that passes everything, and the second one is how this project got a suite
 * that was green over a black screen. `good` must pass every row; each broken page must fail
 * exactly the row named for it and no other.
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
 * What each fixture is supposed to prove. `fails: []` means every row passes.
 *
 * `darkroofs` is in the table with an empty expectation on purpose. It is the defect this
 * harness does **not** catch — a roof painted in the outline slot, near-black against a night
 * sea — and it is pinned here so that nobody later reads the passing matrix as a claim that it
 * does. If a future measurement catches it, this line is what changes.
 */
const EXPECTED = [
  { mode: 'good', fails: [] },
  { mode: 'blank', fails: ['anything', 'framing', 'motion'] },
  { mode: 'diorama', fails: ['framing'] },
  { mode: 'blackhud', fails: ['legibility'] },
  { mode: 'static', fails: ['motion'] },
  { mode: 'throws', fails: ['console'] },
  { mode: 'darkroofs', fails: [] },
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

for (const { mode, fails } of EXPECTED) {
  const report = await look({
    url: `${fixture}?mode=${mode}`,
    out: null,
    evals: [],
    json: false,
    settleMs: 900,
    gapMs: 700,
    width: 1280,
    height: 800,
  });
  const actual = judge(report)
    .filter((row) => row.verdict !== 'pass')
    .map((row) => row.name)
    .sort();
  const expected = [...fails].sort();
  const same = actual.length === expected.length && actual.every((name, i) => name === expected[i]);
  if (same) {
    process.stdout.write(`ok     ${mode.padEnd(10)} failed [${actual.join(', ')}]\n`);
  } else {
    failures++;
    process.stdout.write(
      `BAD    ${mode.padEnd(10)} expected [${expected.join(', ')}], got [${actual.join(', ')}]\n`,
    );
  }
}

process.stdout.write(failures === 0 ? '\nall good\n' : `\n${failures} problem(s)\n`);
process.exit(failures === 0 ? 0 : 1);
