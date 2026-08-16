#!/usr/bin/env node
/**
 * The house rules, enforced.
 *
 * AGENTS.md lists ten non-negotiables. A rule that is only written down is a rule that is
 * followed until the first hurry, so the eight of them that a machine can check are checked
 * here — determinism and its two tiers, layering, environment purity, import hygiene, doc
 * coverage, the banned-syntax list, and whether `.lattice/kit.json` still describes the code.
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

/**
 * Modules that have declared themselves `@browser-only` — the adapters.
 *
 * Reported on every clean run rather than kept quiet, because this list going up is the
 * single clearest early sign that the kit is drifting out of Node. Three is a design; ten
 * is a browser engine wearing an isomorphic label.
 */
const adapters = [];

/**
 * The only modules of `@lattice/core` permitted a Tier B call site.
 *
 * `damp` needs `exp`; `v2Rotate`, `v2Angle` and `v2FromAngle` need `cos`/`sin`/`atan2`.
 * That is the complete list, and it is a list rather than a marker because layer 0 is the
 * foundation every other package's determinism stands on — an escape hatch anyone may write
 * for themselves is a rule anyone may opt out of.
 */
const TIER_B_MODULES = new Set(['math', 'vec2']);

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

    /** A module that declares itself the adapter, and is therefore allowed to touch a host. */
    const browserOnly = raw.slice(0, 2000).includes('@browser-only');
    if (browserOnly) adapters.push(rel);

    lines.forEach((line, n) => {
      const at = n + 1;

      // 1. Determinism. Randomness is seeded and time is a parameter.
      const nondet = line.match(/\b(Math\.random|Date\.now|performance\.now|new Date)\b/);
      if (nondet) {
        fail(rel, at, 'determinism', `${nondet[1]} — take a seeded Rng or a timestamp parameter instead`);
      }

      // 2. The two tiers of determinism.
      //
      //    ECMA-262 specifies `+ - * /`, `Math.sqrt`, `Math.imul` and the bitwise operators
      //    exactly. It explicitly does *not* require `sin`, `cos`, `pow`, `exp` or `log` to
      //    be correctly rounded, so two conforming engines may disagree in the last bit —
      //    which is fine for a pixel and fatal for a hash, a save file or a replay.
      //
      //    They are not banned, because a cost curve is `b · r^k` and there is no honest way
      //    around that. They are required to *declare themselves*: mark the site `@tier-b`
      //    and the result becomes greppable, so an auditor can ask of every one of them
      //    whether it ever reaches a save file.
      const transcendental = line.match(/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|sinh|cosh|tanh)\b/);
      if (transcendental) {
        //    In `core`, the escape hatch is narrower still. Layer 0 is what every other
        //    package's determinism rests on, so a Tier B site here is not merely declared —
        //    it is enumerated. Two modules may hold one, and the rest of the package may
        //    not, because a marker anyone can write is a rule anyone can opt out of.
        const enumerated = id === 'core' && !TIER_B_MODULES.has(basename(file, '.ts'));
        const window = rawLines.slice(Math.max(0, n - 4), n + 1).join('\n');
        if (enumerated) {
          fail(rel, at, 'determinism', `Math.${transcendental[1]} in @lattice/core outside ${[...TIER_B_MODULES].join('/')} — layer 0 is what every other package's determinism rests on, and its Tier B sites are enumerated rather than self-declared`);
        } else if (!window.includes('@tier-b')) {
          fail(rel, at, 'determinism', `Math.${transcendental[1]} is not correctly rounded by spec — mark the site \`@tier-b\` (presentation only, never hashed or persisted) or use Tier A arithmetic`);
        }
      }

      // 3. Environment purity, and the one declared way out of it.
      //
      //    `loop` needs exactly one module that reads `requestAnimationFrame`, and `persist`
      //    needs exactly one that reads `localStorage`. Both packages are otherwise
      //    isomorphic and both would be worse if they were not: the adapter is the point.
      //
      //    So the rule is not "no DOM in these packages" but "the DOM lives in a file that
      //    says so". A module whose header carries `@browser-only` is exempt and is counted;
      //    everything else in the package must still run unchanged in Node. The count is
      //    printed on a clean run, because the number going up is the thing worth noticing.
      if (ISOMORPHIC.has(id) && !browserOnly) {
        const dom = line.match(DOM_GLOBALS);
        if (dom) {
          fail(rel, at, 'purity', `${dom[1]} in an isomorphic package — inject it as an adapter, or declare this module \`@browser-only\` in its header if it IS the adapter`);
        }
        const timer = line.match(/\b(setTimeout|setInterval|queueMicrotask)\b/);
        if (timer) {
          fail(rel, at, 'purity', `${timer[1]} — take an injected schedule function instead, so a test does not have to wait`);
        }
      }

      // 4. Layering, via the declared dependency set.
      const cross = line.match(/from\s+'@lattice\/([a-z0-9-]+)'/);
      if (cross) {
        const dep = cross[1];
        if (dep === id) fail(rel, at, 'layering', 'a package must not import itself by name');
        else if (!allowedDeps.get(id).has(dep)) {
          fail(rel, at, 'layering', `@lattice/${id} (layer ${layerOf.get(id)}) may not import @lattice/${dep} (layer ${layerOf.get(dep)}) — kit.json does not declare the edge`);
        }
      }

      // 5. Import hygiene: NodeNext needs the extension, and barrels build invisible cycles.
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

      // 6. Banned syntax. `any` erases the type system; `!` turns the compiler off exactly
      //    where it was about to be useful.
      if (/(^|[^.\w])any\b(?!\s*=)/.test(line) && /:\s*any\b|<any>|as any\b/.test(line)) {
        fail(rel, at, 'types', "no `any` — use `unknown` and narrow, or name the type");
      }
      if (/[\w\])]![.[]/.test(line)) {
        fail(rel, at, 'types', 'no non-null assertion — handle the undefined case');
      }

      // 7. Doc coverage on the public surface.
      const decl = line.match(/^export\s+(?:declare\s+)?(?:abstract\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
      if (decl) {
        exported.add(decl[1]);
        // The line above must *close* a block comment. Checking `startsWith('*/')` was
        // wrong and cost two agents an afternoon: a doc comment whose last line reads
        // `… and that is why. */` closes perfectly well and failed the rule, so the fix
        // looked like reflowing good prose to satisfy a linter. Ending in `*/` is the
        // property that actually matters.
        const above = (rawLines[n - 1] ?? '').trim();
        if (!above.endsWith('*/')) {
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
// 8. kit.json describes the code that exists
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
  const note = adapters.length ? `, ${adapters.length} declared adapter${adapters.length === 1 ? '' : 's'} (${adapters.join(', ')})` : '';
  console.log(`lint: clean — ${observedExports.size} packages, ${total} public symbols${note}`);
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
