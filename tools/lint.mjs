#!/usr/bin/env node
/**
 * The house rules, enforced.
 *
 * AGENTS.md lists ten non-negotiables. A rule that is only written down is a rule that is
 * followed until the first hurry, so the seven of them that a machine can check are checked
 * here — determinism, layering, environment purity, import hygiene, doc coverage, the
 * banned-syntax list, and whether `.lattice/kit.json` still describes the code.
 *
 * This is deliberately a few hundred lines of regex rather than a typed-AST rule set on top
 * of a linter framework. The kit ships with zero dependencies and the tooling holds itself
 * to the same standard; every rule here is a line-oriented check whose failure message names
 * the file, the line, and what to do instead.
 *
 *   node tools/lint.mjs           check, exit 1 on any violation
 *   node tools/lint.mjs --fix     rewrite the generated parts of kit.json, then check
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = process.argv.includes('--fix');
const KIT_PATH = join(ROOT, '.lattice/kit.json');
const kit = JSON.parse(readFileSync(KIT_PATH, 'utf8'));

/** Packages that must run unchanged in Node with no shims. */
const ISOMORPHIC = new Set(
  Object.entries(kit.packages)
    .filter(([, p]) => p.environment.startsWith('isomorphic'))
    .map(([id]) => id),
);

/** Globals that only exist in a browser. Banned outright in isomorphic packages. */
const DOM_GLOBALS =
  /\b(window|document|localStorage|sessionStorage|navigator|HTMLElement|CanvasRenderingContext2D|AudioContext|requestAnimationFrame)\b/;

const problems = [];
const fail = (file, line, rule, message) => problems.push({ file, line, rule, message });

/** Every `.ts` file under a directory, sorted so output is stable across machines. */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Blank out comments and string/template literals before pattern matching.
 *
 * Without this every rule fires on its own documentation: the sentence "never call
 * `Math.random()`" in a doc comment is exactly the text the determinism rule looks for, and
 * an error message that quotes a banned global is not a use of it. Positions are preserved
 * — each removed character becomes a space — so line numbers stay honest.
 */
function strip(source) {
  let out = '';
  let i = 0;
  const blank = (n) => ' '.repeat(n);
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += blank(stop - i);
      i = stop;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j + 1;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/** The layer index a package sits on, from kit.json. Lower may not import higher. */
const layerOf = new Map();
for (const { layer, packages } of kit.layers) for (const id of packages) layerOf.set(id, layer);

const allowedDeps = new Map(
  Object.entries(kit.packages).map(([id, p]) => [id, new Set(p.dependsOn)]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Per-file rules
// ─────────────────────────────────────────────────────────────────────────────

/** Symbols each package exports, collected while linting and written back to kit.json. */
const observedExports = new Map();

for (const [id] of Object.entries(kit.packages)) {
  const srcDir = join(ROOT, 'packages', id, 'src');
  const files = walk(srcDir);
  const exported = new Set();

  if (files.length === 0) continue;
  if (!files.some((f) => basename(f) === 'index.ts')) {
    fail(`packages/${id}/src/index.ts`, 0, 'entry', 'every package needs one entry point');
  }

  for (const file of files) {
    const rel = relative(ROOT, file);
    const raw = readFileSync(file, 'utf8');
    const code = strip(raw);
    const rawLines = raw.split('\n');
    const lines = code.split('\n');
    const isIndex = basename(file) === 'index.ts';

    lines.forEach((line, n) => {
      const at = n + 1;

      // 1. Determinism. Randomness is seeded and time is a parameter.
      const nondet = line.match(/\b(Math\.random|Date\.now|performance\.now|new Date)\b/);
      if (nondet) {
        fail(rel, at, 'determinism', `${nondet[1]} — take a seeded Rng or a timestamp parameter instead`);
      }

      // 2. Environment purity.
      if (ISOMORPHIC.has(id)) {
        const dom = line.match(DOM_GLOBALS);
        if (dom) {
          fail(rel, at, 'purity', `${dom[1]} in an isomorphic package — inject it as an adapter`);
        }
      }

      // 3. Layering, via the declared dependency set.
      const cross = line.match(/from\s+'@lattice\/([a-z0-9-]+)'/);
      if (cross) {
        const dep = cross[1];
        if (dep === id) fail(rel, at, 'layering', 'a package must not import itself by name');
        else if (!allowedDeps.get(id).has(dep)) {
          fail(rel, at, 'layering', `@lattice/${id} (layer ${layerOf.get(id)}) may not import @lattice/${dep} (layer ${layerOf.get(dep)}) — kit.json does not declare the edge`);
        }
      }

      // 4. Import hygiene: NodeNext needs the extension, and barrels build invisible cycles.
      const relImport = line.match(/from\s+'(\.[^']*)'/);
      if (relImport) {
        const spec = relImport[1];
        if (!spec.endsWith('.js')) {
          fail(rel, at, 'imports', `'${spec}' needs a .js extension — NodeNext will not add one`);
        }
        if (!isIndex && /\/index\.js$|^\.\/index\.js$/.test(spec)) {
          fail(rel, at, 'imports', 'do not import the barrel from inside the package — import the module');
        }
      }

      // 5. Banned syntax. `any` erases the type system; `!` turns the compiler off exactly
      //    where it was about to be useful.
      if (/(^|[^.\w])any\b(?!\s*=)/.test(line) && /:\s*any\b|<any>|as any\b/.test(line)) {
        fail(rel, at, 'types', "no `any` — use `unknown` and narrow, or name the type");
      }
      if (/[\w\])]![.[]/.test(line)) {
        fail(rel, at, 'types', 'no non-null assertion — handle the undefined case');
      }

      // 6. Doc coverage on the public surface.
      const decl = line.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
      if (decl) {
        exported.add(decl[1]);
        const above = (rawLines[n - 1] ?? '').trim();
        if (!above.startsWith('*/') && !above.startsWith('/**')) {
          fail(rel, at, 'docs', `\`${decl[1]}\` is public and undocumented — say what breaks if a caller gets it wrong`);
        }
      }
      const reexport = line.match(/^export\s+(?:type\s+)?\{([^}]*)\}/);
      if (reexport) {
        for (const part of reexport[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (name) exported.add(name);
        }
      }
    });
  }

  observedExports.set(id, [...exported].sort());
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. kit.json describes the code that exists
// ─────────────────────────────────────────────────────────────────────────────

let kitStale = false;
for (const [id, names] of observedExports) {
  const declared = kit.packages[id].exports ?? [];
  if (JSON.stringify(declared) !== JSON.stringify(names)) {
    kitStale = true;
    if (FIX) kit.packages[id].exports = names;
    else {
      const missing = names.filter((n) => !declared.includes(n));
      const gone = declared.filter((n) => !names.includes(n));
      fail('.lattice/kit.json', 0, 'manifest', `@lattice/${id} is out of date — run \`npm run lint -- --fix\`${missing.length ? `; new: ${missing.slice(0, 6).join(', ')}` : ''}${gone.length ? `; removed: ${gone.slice(0, 6).join(', ')}` : ''}`);
    }
  }
}
if (FIX && kitStale) {
  writeFileSync(KIT_PATH, `${JSON.stringify(kit, null, 2)}\n`);
  console.log('lint: refreshed .lattice/kit.json exports');
}

// ─────────────────────────────────────────────────────────────────────────────

if (problems.length === 0) {
  const total = [...observedExports.values()].reduce((n, e) => n + e.length, 0);
  console.log(`lint: clean — ${observedExports.size} packages, ${total} public symbols`);
  process.exit(0);
}

const byRule = new Map();
for (const p of problems) byRule.set(p.rule, (byRule.get(p.rule) ?? 0) + 1);

for (const p of problems) {
  console.error(`${p.file}:${p.line}  [${p.rule}]  ${p.message}`);
}
console.error(`\nlint: ${problems.length} problem${problems.length === 1 ? '' : 's'} — ${[...byRule].map(([r, n]) => `${r} ${n}`).join(', ')}`);
console.error('the rules and their reasons are in AGENTS.md.');
process.exit(1);
