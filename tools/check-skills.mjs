#!/usr/bin/env node
/**
 * The skills' code, compiled — against a `node_modules`, because that is all the reader has.
 *
 * `docs/SKILLS.md` states the constraint the whole skills package is shaped by: **the user has
 * `node_modules`, not this repository.** It also states, as one of the four things that make a
 * skill here good, that *its examples compile — against the published packages, not against the
 * workspace, because the two differ and the difference is exactly what a user hits.*
 *
 * Nothing checked either claim. `check-docs.mjs` compiles `README.md` and `docs/GUIDE.md` and
 * stops there, so the fifty-odd ` ```ts ` blocks a stranger actually pastes — the ones an agent
 * is handed the moment a skill fires — were the least-checked TypeScript in the project.
 *
 * The prototype this grew out of found three, of which the sharpest was `applyPalette(ui, palette)`
 * in the `hud` skill: `ui`'s `Palette` is a bag of CSS strings and `draw`'s is an object, so the
 * call had never typechecked and the fix is `paletteVars(palette)`. Those three are fixed in the
 * tree already; this file's own first run found a fourth, in `looking.md`. Deliberately reverting
 * the `applyPalette` fix and rerunning is the cheapest way to satisfy yourself that the gate still
 * has teeth, and it takes four seconds.
 *
 * ## The three things it does that `check-docs.mjs` does not
 *
 * **1. Each block is its own module.** The docs gate concatenates a document into one program
 * because a guide is a narrative — block four uses the `world` block two built. A skill is not a
 * narrative. Its blocks are independent answers to independent questions, deliberately written so
 * an agent can lift one without reading the rest, and concatenating them would make a duplicate
 * `const camera` across two unrelated sections into a failure while hiding the thing worth
 * catching: a block that does not stand up on its own is a block that does not work when pasted.
 * Forty-four of the forty-five blocks already stood up alone on the first run, so this is a bar
 * the skills were being written to without anyone checking.
 *
 * **2. It compiles against a package, not against `src/`.** `check-docs.mjs` maps
 * `@latticekit/*` at every package's `src/index.ts`. That is the workspace, and it silently forgives
 * three whole classes of defect a reader meets on their first afternoon: a symbol that exists in
 * `src` and is not re-exported from `index.ts`, an `exports` map that does not resolve, and a
 * `files` list that ships no types. So this builds a project **outside the workspace**, gives it
 * a real `node_modules`, and resolves through the package's own `exports` map.
 *
 * **3. It compiles under the reader's flags, not this repository's.** The tsconfig comes out of
 * `skills/lattice/references/scaffold.md` — the very block the scaffold skill tells the reader to
 * write — parsed at run time rather than copied, so the two can never disagree. That is not a
 * softening. Compiled under `tsconfig.base.json` instead, the first run reported `TS4111` on
 * `(globalThis as Record<string, unknown>).__lattice`, a line **two different agents pasted
 * verbatim into two working games**, because the repo turns on `noPropertyAccessFromIndexSignature`
 * and the scaffold does not. A gate that is red about code the reader's compiler accepts is a gate
 * an author learns to argue with, which is the same principle that keeps a favicon 404 out of the
 * looking report. The reader's compiler is the one whose opinion this file is trying to predict.
 *
 * ## The two modes, and why the fast one is the default
 *
 * ```bash
 * npm run skills            # linked: the workspace packages, through their exports maps
 * npm run skills:published  # installed: @latticekit/* from npm, as a stranger gets them
 * ```
 *
 * | | resolves `@latticekit/*` to | compiles with | network | what only this mode catches |
 * |---|---|---|---|---|
 * | **linked** (default) | a symlink to `packages/<name>`, so `exports` → `dist/index.d.ts` | the repo's `typescript` | none | a skill that drifted from **the code in this commit** |
 * | **published** | `npm install @latticekit/<name>@latest` in a cache directory | `typescript@latest`, which is what `scaffold.md` installs and is a **major version** ahead of the repo's | one install | a skill that drifted from **the registry** — the tarball's `files`, every version skew between HEAD and the last publish, and every diagnostic the new compiler reports and the old one does not |
 *
 * Installing nine packages from the registry on every `npm run verify` would make the gate slow
 * and, worse, make it fail when the network is down — and a gate that is red for reasons that
 * have nothing to do with the change in front of you is a gate people learn to rerun rather than
 * read. That is the same principle that keeps a favicon 404 out of the looking report.
 *
 * So the mode is chosen by **where you are** rather than by remembering a flag. On a laptop it is
 * linked: no network, and it catches the same *type* errors (the `applyPalette` defect this file
 * was written to find fails identically in both). **Under `CI` it is published by default**, which
 * is what makes the published check something that actually runs rather than something someone
 * means to run — the job has already done an `npm ci` by then, so the registry is not a new
 * dependency there, and nothing in `.github/workflows` has to know this file exists. `--linked`
 * forces the fast mode; `LATTICE_PUBLISHED=1` or `npm run skills:published` forces the slow one.
 *
 * The honest requirement is that the published check runs somewhere reliable, not that it runs on
 * every keystroke — and neither mode is the one `docs/SKILLS.md` calls the real validation, which
 * is a stranger's empty directory and no repository at all.
 *
 * The published project is **cached** at `$TMPDIR/lattice-skillcheck/published`, so a second run
 * on the same day costs nothing. `--refresh` reinstalls; the versions actually compiled against
 * are printed on every run, because a cache that cannot say what is in it is a cache that lies.
 *
 * ## What a failure looks like
 *
 * ```
 * FAIL  skills/hud/SKILL.md  block 7, lines 240-268
 *       skills/hud/SKILL.md:247:15  TS2345: Argument of type 'Palette' is not assignable to …
 * ```
 *
 * The line number is the line in the skill. An author never sees the generated file, never
 * counts fences to find block seven, and never has to re-derive which of the two `Palette` types
 * the message means — which is the whole difference between a gate and a chore.
 *
 * A block opts out with ` ```ts wrong ` or ` ```ts ignore `; `tools/lib/fences.mjs` has the
 * table of which to use when.
 *
 * Impure: writes a temp project, and in `--published` mode runs `npm install`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tsBlocks } from './lib/fences.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, 'skills');
const PACKAGES = join(ROOT, 'packages');
const SCAFFOLD = join(SKILLS, 'lattice', 'references', 'scaffold.md');

/**
 * A minimum, so that a `skills/` directory that failed to be read reads as a failure rather than
 * as a clean run. The gate this file replaces — none — was green for exactly that reason.
 */
const MIN_BLOCKS = 30;

// ---------------------------------------------------------------------------
// What to compile
// ---------------------------------------------------------------------------

/**
 * Every markdown file under `skills/`, discovered rather than listed.
 *
 * A hand-kept list is a list that a twelfth skill is not on, and the failure is silent — the
 * gate stays green and the new skill is the only unchecked one in the package.
 */
function skillDocuments(dir = SKILLS, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) skillDocuments(path, found);
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

/**
 * Ambient declarations for the environment the reader is in and this repository is not.
 *
 * A scaffolded Vite project defines `import.meta.hot` through `vite/client`; a bare `tsc` does not,
 * and a skill that teaches HMR disposal is not wrong for using it. Declaring it here rather than reaching for
 * `vite/client` keeps this gate's `node_modules` to the nine packages under test — the whole
 * point being to compile against *those* and nothing else.
 *
 * Keep this file tiny and adversarially reviewed. Every line in it is a type error this gate
 * agrees not to see.
 */
const AMBIENT = `// Provided by the reader's bundler, not by any @latticekit package.
interface ImportMetaHot {
  accept(cb?: (mod: unknown) => void): void;
  dispose(cb: (data: Record<string, unknown>) => void): void;
  readonly data: Record<string, unknown>;
}
interface ImportMeta {
  readonly hot?: ImportMetaHot;
}
`;

/**
 * The compiler options a reader ends up with, lifted out of the scaffold skill.
 *
 * Read rather than restated. `scaffold.md` is what an agent following the `lattice` command
 * actually writes into the user's project, so a copy here would be a second source of truth for
 * the one question this gate is asking — *would the reader's compiler accept this?* — and the day
 * the two disagree is the day this file starts reporting on a project nobody has.
 *
 * Two overrides, both because the temp project is not a Vite app:
 *
 * - `types` is emptied. The scaffold's `["vite/client"]` is what supplies `import.meta.hot`, and
 *   installing Vite here to get one interface would drag a hundred packages into a gate whose
 *   whole point is to have the nine and nothing else. `gen/ambient.d.ts` declares it instead.
 * - `include` points at the generated blocks rather than at `src`.
 *
 * Everything else — `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, the module and
 * resolution modes — is exactly what the reader gets, including the settings this repository turns
 * on and the scaffold does not.
 */
function readerTsconfig() {
  const markdown = readFileSync(SCAFFOLD, 'utf8');
  const match = /###\s+`tsconfig\.json`[\s\S]*?```json\n([\s\S]*?)```/.exec(markdown);
  if (!match) {
    fail(
      'check-skills: could not find the `tsconfig.json` block in skills/lattice/references/scaffold.md.\n' +
        'That block is where this gate gets the reader\'s compiler options. If the heading or the\n' +
        'fence moved, move this pattern with it — do not restate the options here, or the gate and\n' +
        'the skill will disagree about what a reader is running.',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    fail(`check-skills: the tsconfig block in scaffold.md is not valid JSON — ${error.message}`);
  }
  return {
    $comment:
      'Written by tools/check-skills.mjs. The compiler options are read out of ' +
      'skills/lattice/references/scaffold.md so that this gate and the skills cannot disagree ' +
      'about what a reader is compiling with. Edit that block, not this file.',
    ...parsed,
    compilerOptions: { ...parsed.compilerOptions, noEmit: true, types: [] },
    include: ['gen/**/*.ts'],
  };
}

// ---------------------------------------------------------------------------
// The project the blocks are compiled in
// ---------------------------------------------------------------------------

const PACKAGE_NAMES = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

/**
 * A directory outside the workspace with `node_modules/@latticekit/*` in it.
 *
 * Outside is load-bearing twice over: inside `packages/` or `examples/` npm would treat it as a
 * workspace member and hoist its dependencies to the repo root, and `tsc` would walk up into the
 * repo's own `tsconfig.json`. Either would quietly put us back to compiling against `src/`, which
 * is the thing this file exists not to do.
 */
function linkedProject(dir) {
  rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
  const scope = join(dir, 'node_modules', '@latticekit');
  mkdirSync(scope, { recursive: true });
  const versions = [];
  for (const name of PACKAGE_NAMES) {
    const manifest = join(PACKAGES, name, 'package.json');
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!existsSync(join(PACKAGES, name, 'dist', 'index.d.ts'))) {
      fail(
        `check-skills: packages/${name}/dist is missing. Run \`npm run build\` first — this gate ` +
          'resolves through each package\'s exports map, which points at dist and not at src.',
      );
    }
    symlinkSync(join(PACKAGES, name), join(scope, name), 'dir');
    versions.push(`${pkg.name}@${pkg.version}`);
  }
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) fail('check-skills: typescript is not installed. Run `npm ci` at the repo root.');
  return { versions, tsc, compiler: `typescript@${vendoredTypescriptVersion()}` };
}

/** The compiler this repository vendors, named in the report so nobody has to guess. */
function vendoredTypescriptVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'node_modules', 'typescript', 'package.json'), 'utf8')).version;
}

/**
 * The same directory, filled from the registry instead. Cached; `--refresh` empties it first.
 *
 * `typescript` is installed alongside the nine, unpinned, because `scaffold.md` installs it
 * unpinned — `npm i -D vite typescript` — and the reader therefore compiles with whatever the
 * registry calls latest, which is a **major version ahead of the one this repository vendors**.
 * A gate that predicts the reader's compiler and then runs a different one is predicting the
 * wrong thing. The linked mode keeps the repo's `tsc`, since its whole promise is to need no
 * network.
 */
function publishedProject(dir, refresh) {
  const scope = join(dir, 'node_modules', '@latticekit');
  const complete =
    !refresh &&
    existsSync(join(dir, 'node_modules', 'typescript', 'package.json')) &&
    PACKAGE_NAMES.every((n) => existsSync(join(scope, n, 'package.json')));

  if (!complete) {
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    rmSync(join(dir, 'package-lock.json'), { force: true });
    const specs = [...PACKAGE_NAMES.map((n) => `@latticekit/${n}@latest`), 'typescript@latest'];
    process.stdout.write(`check-skills: installing ${specs.length} packages from npm…\n`);
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', ...specs], {
        cwd: dir,
        stdio: 'pipe',
      });
    } catch (error) {
      const why = `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`.trim();
      fail(
        'check-skills: could not install the published packages.\n' +
          `${why}\n\n` +
          'This mode needs the registry. Run `npm run skills` for the offline check against the ' +
          'workspace, and let CI take the published one.',
      );
    }
  }

  const versions = PACKAGE_NAMES.map((name) => {
    const pkg = JSON.parse(readFileSync(join(scope, name, 'package.json'), 'utf8'));
    return `${pkg.name}@${pkg.version}`;
  });
  const ts = JSON.parse(readFileSync(join(dir, 'node_modules', 'typescript', 'package.json'), 'utf8'));
  return {
    versions,
    tsc: join(dir, 'node_modules', 'typescript', 'bin', 'tsc'),
    compiler: `typescript@${ts.version}`,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
/**
 * Published by default **in CI**, linked by default everywhere else.
 *
 * This is the whole answer to "where does the published check actually run?". CI has already run
 * `npm ci` by the time this executes, so the registry is not a new dependency there; a laptop on a
 * train is where an install would be a new dependency, and that is exactly where the default flips
 * the other way. `--linked` forces the fast mode back on if a CI job wants it.
 *
 * `CI` is set by GitHub Actions and by every other runner worth naming, so nothing in
 * `.github/workflows` has to know this file exists.
 */
const published =
  argv.includes('--published') ||
  process.env.LATTICE_PUBLISHED === '1' ||
  (Boolean(process.env.CI) && !argv.includes('--linked'));
const refresh = argv.includes('--refresh');
const keep = argv.includes('--keep');

const base = join(tmpdir(), 'lattice-skillcheck');
const dir = join(base, published ? 'published' : 'linked');
mkdirSync(dir, { recursive: true });
// Emptied rather than added to: a block that was deleted from a skill must not go on being
// compiled from a leftover file, which is how a cached gate starts reporting on a document that
// no longer exists.
rmSync(join(dir, 'gen'), { recursive: true, force: true });
mkdirSync(join(dir, 'gen'), { recursive: true });

// `type: module`, which is what `npm pkg set type=module` gives the reader on the second line of
// the scaffold. It is also what stops a `require` interpretation of anything here.
writeFileSync(
  join(dir, 'package.json'),
  `${JSON.stringify({ name: 'lattice-skillcheck', private: true, type: 'module' }, null, 2)}\n`,
);
writeFileSync(join(dir, 'gen', 'ambient.d.ts'), AMBIENT);

const { versions, tsc, compiler } = published ? publishedProject(dir, refresh) : linkedProject(dir);

/** Generated file → the skill and the lines it came from, so `tsc`'s output can be translated. */
const origin = new Map();
const documents = [];

for (const path of skillDocuments()) {
  const doc = relative(ROOT, path);
  const blocks = tsBlocks(readFileSync(path, 'utf8'));
  documents.push({ doc, count: blocks.length });
  blocks.forEach((block, index) => {
    const slug = doc.replace(/[^a-zA-Z0-9]+/g, '_');
    const generated = join(dir, 'gen', `${slug}__${index}.ts`);
    // The code starts at line 1 and `export {}` is appended, so a `tsc` line number maps to the
    // source by a single addition. Anything that shifted lines here would have to be undone in
    // the translation below, and a translation with arithmetic in two places drifts.
    writeFileSync(generated, `${block.code}\nexport {};\n`);
    origin.set(generated, {
      doc,
      index,
      firstLine: block.line,
      lastLine: block.line + block.code.split('\n').length - 1,
    });
  });
}

const total = [...origin.keys()].length;
if (total < MIN_BLOCKS) {
  fail(
    `check-skills: found only ${total} compilable TypeScript blocks under skills/, and expected ` +
      `at least ${MIN_BLOCKS}. Either the skills package shrank a great deal or this gate stopped ` +
      'reading it — the second is the one that would otherwise pass silently.',
  );
}

writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(readerTsconfig(), null, 2)}\n`);

let diagnostics = '';
try {
  execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json'), '--pretty', 'false'], {
    cwd: dir,
    stdio: 'pipe',
  });
} catch (error) {
  diagnostics = `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`;
}

/**
 * `tsc`'s diagnostics, rewritten to name the skill and the line inside it.
 *
 * A message that points at `gen/skills_hud_SKILL_md__7.ts(12,15)` is one an author has to decode
 * before they can act on it, and the file it names is deleted by the time they look. Non-negotiable
 * 9 is that an error names the caller's mistake; a gate is held to its own rule.
 */
function translate(output) {
  const byBlock = new Map();
  const stray = [];
  /** The entry the next continuation line belongs to. `tsc` indents them under their diagnostic. */
  let open = null;
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue;
    const match = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(line);
    if (!match) {
      // A continuation line — `Index signature for type 'string' is missing…` under its TS2345.
      // It carries the half of the explanation an author actually needs, so losing it would leave
      // the message shorter and worse.
      if (open) open.messages.push(`      ${line.trim()}`);
      else stray.push(line.trim());
      continue;
    }
    const [, file, row, column, message] = match;
    const where = origin.get(file.startsWith('/') ? file : join(dir, file));
    if (!where) {
      open = null;
      stray.push(line.trim());
      continue;
    }
    const key = `${where.doc}#${where.index}`;
    if (!byBlock.has(key)) byBlock.set(key, { where, messages: [] });
    open = byBlock.get(key);
    // Clamp: the appended `export {}` is one line past the block, and an error reported there is
    // about the block's last line as far as a reader is concerned.
    const sourceLine = Math.min(where.lastLine, where.firstLine + Number(row) - 1);
    open.messages.push(`      ${where.doc}:${sourceLine}:${column}  ${message}`);
  }
  return { byBlock, stray };
}

if (diagnostics.trim() !== '') {
  const { byBlock, stray } = translate(diagnostics);
  const lines = [''];
  for (const { where, messages } of byBlock.values()) {
    lines.push(
      `FAIL  ${where.doc}  block ${where.index}, lines ${where.firstLine}-${where.lastLine}`,
      ...messages,
      '',
    );
  }
  for (const line of stray) lines.push(`FAIL  ${line}`);
  lines.push(
    '',
    `check-skills: ${byBlock.size} of ${total} blocks do not compile against ` +
      `${published ? 'the published packages' : 'the workspace packages'} under ${compiler} ` +
      'with the scaffold skill\'s own tsconfig.',
    'Line numbers are lines in the skill. Fix the skill — or, if the block is the wrong-version',
    'half of a trap, tag its fence ```ts wrong; if it is a fragment rather than a program,',
    '```ts ignore. tools/lib/fences.mjs has the table.',
  );
  process.stderr.write(`${lines.join('\n')}\n`);
  if (!keep) rmSync(join(dir, 'gen'), { recursive: true, force: true });
  process.exit(1);
}

if (!keep) rmSync(join(dir, 'gen'), { recursive: true, force: true });

const withBlocks = documents.filter((d) => d.count > 0);
for (const { doc, count } of withBlocks) {
  process.stdout.write(`check-skills: ${doc} — ${count} block${count === 1 ? '' : 's'} compile\n`);
}
process.stdout.write(
  `check-skills: ${total} blocks across ${withBlocks.length} documents compile under ${compiler}, ` +
    `with scaffold.md's tsconfig, against ${published ? 'the published' : 'the workspace'} packages\n` +
    `check-skills: ${versions.join(', ')}\n`,
);
